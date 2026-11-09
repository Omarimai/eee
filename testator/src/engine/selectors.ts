import type { SelectorCandidate } from '../types';

interface RawElement {
  tag: string;
  id: string | null;
  name: string | null;
  dataTestId: string | null;
  accessibleName: string | null;
  cssPath: string;
  xpath: string;
}

export function buildSelectors(raw: RawElement): SelectorCandidate[] {
  const candidates: SelectorCandidate[] = [];

  if (raw.dataTestId) {
    candidates.push({ type: 'data-testid', value: `[data-testid="${raw.dataTestId}"]`, confidence: 'high' });
  }
  if (raw.id) {
    candidates.push({ type: 'id', value: `#${raw.id}`, confidence: 'high' });
  }
  if (raw.name) {
    candidates.push({ type: 'name', value: `[name="${raw.name}"]`, confidence: 'high' });
  }
  if (raw.accessibleName) {
    candidates.push({ type: 'label', value: raw.accessibleName, confidence: 'medium' });
  }
  candidates.push({ type: 'css', value: raw.cssPath, confidence: 'low' });
  candidates.push({ type: 'xpath', value: raw.xpath, confidence: 'low' });

  return candidates;
}

// Derived from the already-disambiguated best selector rather than its own
// priority logic, so a fingerprint is only ever reused when two elements are
// genuinely indistinguishable by every attribute we collected (which the nth
// disambiguation pass in scan.ts resolves before this is called).
export function computeFingerprint(best: SelectorCandidate): string {
  return `${best.type}:${best.value}${typeof best.nth === 'number' ? `#${best.nth}` : ''}`;
}
