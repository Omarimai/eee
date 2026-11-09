import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import type { Config } from '../types';

export interface ScenarioStep {
  action: string;
  selector: { type: string; value: string };
  value: unknown;
  tag: string;
  timestamp: number;
}

// Runs inside the browser via page.evaluate — attaches capture-phase
// listeners that forward every click/change on an interactive element
// back to Node through the exposed __testatorOnEvent function.
function inPageRecorder() {
  // See the matching comment in scan.ts — shims tsx/esbuild's __name helper,
  // which page.evaluate() doesn't carry over for isolated function sources.
  (globalThis as any).__name ??= (fn: unknown) => fn;

  function bestSelectorFor(el: any) {
    if (el.id) return { type: 'id', value: '#' + el.id };
    const testId = el.getAttribute && el.getAttribute('data-testid');
    if (testId) return { type: 'data-testid', value: `[data-testid="${testId}"]` };
    if (el.name) return { type: 'css', value: `[name="${el.name}"]` };
    return { type: 'css', value: el.tagName.toLowerCase() };
  }
  function handler(e: Event) {
    const target = e.target as HTMLElement;
    if (!target || !target.closest) return;
    const interactive = target.closest(
      'input, select, textarea, button, a, [contenteditable="true"], summary, [data-id]'
    ) as any;
    if (!interactive) return;
    const selector = bestSelectorFor(interactive);
    const action = e.type === 'click' ? 'click' : e.type === 'change' ? 'change' : 'input';
    let value: unknown = null;
    if (interactive.type === 'checkbox' || interactive.type === 'radio') value = interactive.checked;
    else if ('value' in interactive) value = interactive.value;
    // @ts-ignore — injected by exposeFunction
    window.__testatorOnEvent({
      action,
      selector,
      value,
      tag: interactive.tagName.toLowerCase(),
      timestamp: Date.now(),
    });
  }
  document.addEventListener('click', handler, true);
  document.addEventListener('change', handler, true);
  (window as any).__testatorRecordingHandler = handler;
}

export async function startRecording(page: Page, onStep: (step: ScenarioStep) => void): Promise<void> {
  await page.exposeFunction('__testatorOnEvent', (step: ScenarioStep) => onStep(step));
  await page.evaluate(inPageRecorder);
}

export async function stopRecording(page: Page): Promise<void> {
  await page.evaluate(() => {
    const handler = (window as any).__testatorRecordingHandler;
    if (handler) {
      document.removeEventListener('click', handler, true);
      document.removeEventListener('change', handler, true);
    }
  });
}

export function saveScenario(name: string, steps: ScenarioStep[], config: Config): string {
  fs.mkdirSync(config.scenariosDir, { recursive: true });
  const jsonPath = path.join(config.scenariosDir, `${name}.json`);
  const txtPath = path.join(config.scenariosDir, `${name}.txt`);
  fs.writeFileSync(jsonPath, JSON.stringify({ name, recordedAt: new Date().toISOString(), steps }, null, 2));
  fs.writeFileSync(
    txtPath,
    steps
      .map(
        (s, i) =>
          `${i + 1}. ${s.action} ${s.selector.type}=${s.selector.value}${
            s.value !== null && s.value !== undefined ? ` value=${JSON.stringify(s.value)}` : ''
          }`
      )
      .join('\n')
  );
  return jsonPath;
}

export function listScenarios(config: Config): string[] {
  if (!fs.existsSync(config.scenariosDir)) return [];
  return fs
    .readdirSync(config.scenariosDir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''));
}

export function loadScenario(name: string, config: Config): { name: string; recordedAt: string; steps: ScenarioStep[] } {
  return JSON.parse(fs.readFileSync(path.join(config.scenariosDir, `${name}.json`), 'utf8'));
}

export async function replayStep(page: Page, step: ScenarioStep): Promise<void> {
  const locator = page.locator(step.selector.value);
  if (step.action === 'click') {
    await locator.click();
  } else if (step.action === 'change' || step.action === 'input') {
    if (typeof step.value === 'boolean') {
      if (step.value) await locator.check();
      else await locator.uncheck();
    } else if (step.value !== null && step.value !== undefined) {
      await locator.fill(String(step.value));
    }
  }
}
