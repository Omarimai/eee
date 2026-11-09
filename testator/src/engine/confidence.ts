import type { ElementRecord } from '../types';

/**
 * Derives a ●/◐/○ confidence badge per element from data the scanner
 * already captured — no new DOM reads, no extra work. Lets the Explorer
 * show at a glance which elements are safe to automate against without the
 * user pressing "Inspect" on every single one.
 */
export type ConfidenceLevel = 'complete' | 'partial' | 'needs-inspection';

// Three weak/strong signals, all from fields the scanner already captures —
// no new DOM data needed. Each one independently suggests "the scanner isn't
// fully sure about this element"; stacking them is what pushes a field from
// a passing grade down to "go look at this yourself."
export function deriveConfidence(el: ElementRecord): ConfidenceLevel {
  let weak = 0;
  if (el.bestSelector.confidence === 'low') weak++;
  if (!el.accessibleName) weak++;
  // getAvailableActions only actually returns [] for a disabled element
  // today, so this rarely fires in practice — kept for forward-compat (a
  // future custom-widget case the action table doesn't recognize yet)
  // rather than because it's expected to matter much right now.
  if (el.availableActions.length === 0 && !el.disabled && !el.readonly) weak++;

  if (weak === 0) return 'complete';
  if (weak === 1) return 'partial';
  return 'needs-inspection';
}

export function confidenceGlyph(level: ConfidenceLevel): string {
  return level === 'complete' ? '●' : level === 'partial' ? '◐' : '○';
}

export function confidenceLabel(level: ConfidenceLevel): string {
  return level === 'complete' ? 'Complete' : level === 'partial' ? 'Partial' : 'Needs inspection';
}
