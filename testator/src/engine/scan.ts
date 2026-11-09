import type { Page } from 'playwright';
import { buildSelectors, computeFingerprint } from './selectors';
import { getAvailableActions } from './actions';
import type { Config, ScreenScan, ElementRecord } from '../types';

interface RawScanResult {
  tag: string;
  type: string | null;
  id: string | null;
  name: string | null;
  dataTestId: string | null;
  classes: string[];
  cssPath: string;
  xpath: string;
  visible: boolean;
  disabled: boolean;
  readonly: boolean;
  required: boolean;
  draggable: boolean;
  contentEditable: boolean;
  multiple: boolean;
  value: string | null;
  options?: { value: string; label: string }[];
  selectedValues?: string[];
  accessibleName: string | null;
  role: string | null;
  groupContext: string | null;
  formId: string | null;
  isCustomInteractive: boolean;
}

// Runs inside the browser via page.evaluate — must not reference anything
// outside its own body (no Node-side closures), only browser globals.
function inPageScan(contentSelector: string): RawScanResult[] {
  const root = document.querySelector(contentSelector) || document.body;
  // Native form controls, plus the generic patterns real-world sites use for
  // custom-widget interactivity: a keyboard-focusable tabindex, or an
  // explicit ARIA role announcing it as a control. Covers things like
  // clickable <li>/<div> result rows that aren't a native <button>/<a>.
  const SELECTOR = [
    'input',
    'select',
    'textarea',
    'button',
    'a[href]',
    '[contenteditable="true"]',
    '[draggable="true"]',
    'summary',
    '[tabindex]',
    '[role="button"]',
    '[role="link"]',
    '[role="option"]',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
  ].join(', ');
  const nodes = Array.from(root.querySelectorAll(SELECTOR)) as HTMLElement[];

  // tsx/esbuild wraps named nested functions below with calls to a __name
  // helper that's normally defined once per module. page.evaluate() ships
  // only this function's own source into the browser, so that definition
  // doesn't travel with it — shim it locally so the wrapped calls resolve.
  (globalThis as any).__name ??= (fn: unknown) => fn;

  function isVisible(el: HTMLElement): boolean {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function cssPath(el: HTMLElement): string {
    if (el.id) return '#' + el.id;
    const parts: string[] = [];
    let node: HTMLElement | null = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      let selector = node.tagName.toLowerCase();
      if (node.classList.length) {
        selector += '.' + Array.from(node.classList).slice(0, 2).join('.');
      }
      const parent: HTMLElement | null = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === node!.tagName);
        if (siblings.length > 1) {
          selector += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
        }
      }
      parts.unshift(selector);
      node = parent;
      depth++;
    }
    return parts.join(' > ');
  }

  function xpath(el: HTMLElement): string {
    if (el.id) return `//*[@id="${el.id}"]`;
    const parts: string[] = [];
    let node: HTMLElement | null = el;
    while (node && node.nodeType === 1) {
      let index = 1;
      let sib = node.previousElementSibling;
      while (sib) {
        if (sib.tagName === node.tagName) index++;
        sib = sib.previousElementSibling;
      }
      parts.unshift(node.tagName.toLowerCase() + '[' + index + ']');
      node = node.parentElement;
    }
    return '/' + parts.join('/');
  }

  function accessibleName(el: any): string | null {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl && lbl.textContent) return lbl.textContent.trim();
    }
    const parentLabel = el.closest('label');
    if (parentLabel && parentLabel.textContent) return parentLabel.textContent.trim();
    if (el.placeholder) return el.placeholder.trim();
    if (el.textContent) {
      // This value isn't just for display — it becomes the literal match
      // string for the 'label' selector type (an exact getByText() in
      // interact.ts). A truncated-with-"..." version doesn't exist anywhere
      // in the real DOM, so exact-matching it times out and the element can
      // never be activated/clicked by selector. Any display-length limit
      // belongs in whatever's rendering this (the Explorer already truncates
      // visually via wrap="truncate-end"), not baked into the identity value
      // itself.
      const text = el.textContent.trim().replace(/\s+/g, ' ');
      if (text) return text;
    }
    return null;
  }

  function groupContext(el: HTMLElement): string | null {
    let node: HTMLElement | null = el;
    while (node && node !== root) {
      let sib: Element | null = node.previousElementSibling;
      while (sib) {
        if (sib.classList && sib.classList.contains('field-group-title')) {
          return sib.textContent ? sib.textContent.trim() : null;
        }
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    const panel = el.closest('[data-group-panel]');
    if (panel) {
      const groupKey = panel.getAttribute('data-group-panel');
      const btn = document.querySelector(`.group-nav-btn[data-group="${groupKey}"]`);
      if (btn && btn.textContent) return btn.textContent.trim();
    }
    const details = el.closest('details');
    if (details) {
      const summary = details.querySelector('summary');
      if (summary && summary.textContent) return summary.textContent.trim();
    }
    return null;
  }

  return nodes.map((el: any) => {
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type');
    const form = el.closest('form');

    let value: string | null = null;
    let options: { value: string; label: string }[] | undefined;
    let selectedValues: string[] | undefined;
    if (tag === 'select') {
      value = Array.from(el.selectedOptions as HTMLOptionElement[])
        .map(o => o.value)
        .join(', ');
      options = Array.from(el.options as HTMLOptionElement[]).map(o => ({
        value: o.value,
        label: (o.textContent || o.value).trim(),
      }));
      selectedValues = Array.from(el.selectedOptions as HTMLOptionElement[]).map(o => o.value);
    } else if (el.isContentEditable) {
      value = el.textContent;
    } else if ('value' in el) {
      value = el.value;
    } else {
      value = el.textContent ? el.textContent.trim() : null;
    }

    return {
      tag,
      type,
      id: el.id || null,
      name: el.getAttribute('name') || null,
      dataTestId: el.getAttribute('data-testid') || null,
      classes: Array.from(el.classList) as string[],
      cssPath: cssPath(el),
      xpath: xpath(el),
      visible: isVisible(el),
      disabled: el.disabled === true || !!el.closest('fieldset[disabled]'),
      readonly: el.readOnly === true,
      required: el.required === true,
      draggable: el.getAttribute('draggable') === 'true',
      contentEditable: el.isContentEditable === true,
      multiple: el.multiple === true,
      value,
      options,
      selectedValues,
      accessibleName: accessibleName(el),
      role: el.getAttribute('role'),
      groupContext: groupContext(el),
      formId: form ? form.id || null : null,
      // True for things like a clickable <li>/<div> result row — picked up
      // via [tabindex]/[role=...] rather than a native interactive tag. A
      // plain mouse click isn't guaranteed to do anything meaningful on
      // these (many only wire up dblclick/keydown handlers); keyboard
      // activation (focus + Enter) is the behavior WAI-ARIA authoring
      // practices require such widgets to support, so it's the safer bet.
      isCustomInteractive:
        !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'SUMMARY'].includes(el.tagName) &&
        !(el.tagName === 'A' && el.hasAttribute('href')) &&
        (el.hasAttribute('tabindex') || el.hasAttribute('role')),
    };
  });
}

export async function scanScreen(
  page: Page,
  workspace: string,
  screen: string,
  config: Config
): Promise<ScreenScan> {
  const raws = await page.evaluate(inPageScan, config.selectors.contentRegion);

  const prepared = raws.map(raw => ({
    raw,
    selectors: buildSelectors(raw),
    availableActions: getAvailableActions(
      raw.tag,
      raw.type,
      raw.draggable,
      raw.contentEditable,
      raw.multiple,
      raw.disabled,
      raw.readonly,
      raw.isCustomInteractive
    ),
  }));

  // Disambiguate selector candidates that match more than one element in
  // this scan — duplicate ids, and repeated button/link text in a list or
  // table, are routine on real-world pages, not just contrived edge cases.
  // Each repeat of the same (type, value) pair gets an incrementing `nth`
  // so it can still be addressed unambiguously via .nth(n).
  const occurrences = new Map<string, number>();
  const elements: ElementRecord[] = prepared.map((p, index) => {
    const selectors = p.selectors.map(sel => {
      const key = `${sel.type}:${sel.value}`;
      const seen = occurrences.get(key) ?? 0;
      occurrences.set(key, seen + 1);
      return seen > 0 ? { ...sel, nth: seen } : sel;
    });
    const bestSelector = selectors[0];
    return {
      ...p.raw,
      index,
      selectors,
      bestSelector,
      fingerprint: computeFingerprint(bestSelector),
      availableActions: p.availableActions,
    };
  });

  const suggestedFlows = buildSuggestedFlows(elements);

  return {
    workspace,
    screen,
    url: page.url(),
    scannedAt: new Date().toISOString(),
    elements,
    suggestedFlows,
  };
}

function buildSuggestedFlows(elements: ElementRecord[]): string[] {
  const groups = new Map<string, ElementRecord[]>();
  for (const el of elements) {
    if (!el.formId) continue;
    if (!groups.has(el.formId)) groups.set(el.formId, []);
    groups.get(el.formId)!.push(el);
  }

  const flows: string[] = [];
  for (const els of groups.values()) {
    const fillable = els.filter(
      e =>
        e.availableActions.includes('fill') ||
        e.availableActions.includes('selectOption') ||
        e.availableActions.includes('selectOptions') ||
        e.availableActions.includes('check')
    );
    const submit = els.find(e => e.tag === 'button' && e.availableActions.includes('click'));
    if (fillable.length && submit) {
      const labels = fillable
        .map(e => e.accessibleName || e.name || e.id)
        .filter(Boolean)
        .join(', ');
      if (labels) {
        flows.push(`Fill ${labels} → click "${submit.accessibleName || 'Submit'}"`);
      }
    }
  }
  return flows;
}
