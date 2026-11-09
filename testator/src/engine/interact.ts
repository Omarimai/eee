import type { Locator, Page } from 'playwright';
import type { ElementRecord, SelectorCandidate } from '../types';

/**
 * Turns a scanned `ElementRecord` + its best selector into a real Playwright
 * action against the live browser: click/activate (`tryElement`) or
 * fill/select (`fillElement`). This is the only place that actually touches
 * the browser on the user's behalf — everything upstream (`scan.ts`,
 * `actions.ts`) just decides WHAT could be done; this does it.
 */

// bestSelector.value is already a ready-to-use CSS string for id/name/
// data-testid/css types, but 'label' holds raw accessible-name text and
// 'xpath' needs an explicit prefix — Playwright's default locator() only
// treats a bare string as CSS.
//
// 'label' is scoped to the tested content region: free-text matches are the
// one selector type likely to collide with identical text living elsewhere
// on a real page (a "Search" link in the nav bar, "Delete" repeated down a
// table, etc). id/name/css/xpath are left page-global since they're already
// structurally precise — but if the same (type, value) matched more than one
// element in the scan, `nth` (set by the disambiguation pass in scan.ts)
// picks out exactly the one that was actually scanned.
export function buildLocator(page: Page, selector: SelectorCandidate, contentRegionSelector: string): Locator {
  let locator: Locator;
  switch (selector.type) {
    case 'xpath':
      locator = page.locator(`xpath=${selector.value}`);
      break;
    case 'label':
      locator = page.locator(contentRegionSelector).getByText(selector.value, { exact: true });
      break;
    default:
      locator = page.locator(selector.value);
  }
  return typeof selector.nth === 'number' ? locator.nth(selector.nth) : locator.first();
}

export async function tryElement(page: Page, el: ElementRecord, contentRegionSelector: string): Promise<string> {
  const locator = buildLocator(page, el.bestSelector, contentRegionSelector);
  const name = el.accessibleName || el.id || el.name || `<${el.tag}>`;

  if (el.availableActions.includes('activate')) {
    // Custom widgets (e.g. a clickable result row) often only wire up
    // dblclick/keydown handlers, not plain click — focus + Enter is the
    // behavior WAI-ARIA authoring practices require such widgets to expose,
    // so it's the more broadly reliable way to "do the obvious thing" here.
    await locator.focus({ timeout: 5000 });
    await page.keyboard.press('Enter');
    return `Activated "${name}" via keyboard (focus + Enter) in the browser`;
  }
  if (el.availableActions.includes('click')) {
    await locator.click({ timeout: 5000 });
    return `Clicked "${name}" in the browser`;
  }
  if (
    el.availableActions.includes('check') ||
    el.availableActions.includes('uncheck') ||
    el.availableActions.includes('toggle')
  ) {
    await locator.click({ timeout: 5000 });
    return `Toggled "${name}" in the browser`;
  }
  await locator.focus({ timeout: 5000 });
  return `Focused "${name}" in the browser (read-only — no value changed)`;
}

export async function fillElement(
  page: Page,
  el: ElementRecord,
  contentRegionSelector: string,
  value: string | string[]
): Promise<string> {
  const locator = buildLocator(page, el.bestSelector, contentRegionSelector);
  const name = el.accessibleName || el.id || el.name || `<${el.tag}>`;

  if (el.availableActions.includes('selectOption') || el.availableActions.includes('selectOptions')) {
    const values = Array.isArray(value) ? value : [value];
    try {
      // The option picker always passes real option.value strings — select
      // by value first. Falls back to matching by displayed label text for
      // the rare case this gets reached without a known options list.
      await locator.selectOption(values, { timeout: 5000 });
    } catch {
      await locator.selectOption(
        values.map(v => ({ label: v })),
        { timeout: 5000 }
      );
    }
    return `Selected ${values.map(v => `"${v}"`).join(', ')} in "${name}"`;
  }

  await locator.fill(String(value), { timeout: 5000 });
  return `Filled "${name}" with "${String(value)}"`;
}
