import type { ScreenScan, ElementRecord, ExplorationEvent, ChangedElement } from '../types';

/**
 * Builds the chronological `ExplorationEvent` log the saved report's
 * navigation timeline, graph, and overview are all reconstructed from.
 *
 * `ElementExplorer.tsx` calls `buildExplorationEvent` once per action (plus
 * once for the initial scan), pairing the scan taken right before the
 * action with the one taken right after it settled — never deriving
 * "what's new" from a single final DOM snapshot. A "screen" (Cases, Users,
 * ...) is fixed for the whole report; navigating within it just changes
 * the *page* (URL) — see `ExplorationEvent.navigated` and the "page" vs.
 * "screen" wording throughout `report.ts`.
 */

// `el.index` is only stable within ONE scan of ONE page — it gets
// reassigned 0..N on every rescan, and two different pages' elements can
// land on the same index by coincidence. `fingerprint` is at least stable
// across rescans of the SAME page; pairing it with the page's URL is what
// actually makes a key safe to use across every page visited this session.
export function elementKey(url: string, el: ElementRecord): string {
  return `${url}::${el.fingerprint}`;
}

// Real field-level diff between two scans of the SAME page — distinct from
// diff.ts's diffScans (which is for comparing against a previously *saved*
// report and includes a label+group fallback match for lost ids/names).
// This one only needs fingerprint matching since both scans are live, taken
// seconds apart, by the same session.
function diffSamePage(before: ScreenScan, after: ScreenScan): { removed: ElementRecord[]; changed: ChangedElement[] } {
  const oldByFingerprint = new Map(before.elements.map(e => [e.fingerprint, e]));
  const newByFingerprint = new Map(after.elements.map(e => [e.fingerprint, e]));
  const removed = before.elements.filter(e => !newByFingerprint.has(e.fingerprint));
  const changed: ChangedElement[] = [];
  for (const ne of after.elements) {
    const oe = oldByFingerprint.get(ne.fingerprint);
    if (!oe) continue;
    const diffs: string[] = [];
    if (oe.type !== ne.type) diffs.push(`type ${oe.type ?? 'none'} → ${ne.type ?? 'none'}`);
    if (oe.disabled !== ne.disabled) diffs.push(`disabled ${oe.disabled} → ${ne.disabled}`);
    if (oe.required !== ne.required) diffs.push(`required ${oe.required} → ${ne.required}`);
    if (oe.readonly !== ne.readonly) diffs.push(`readonly ${oe.readonly} → ${ne.readonly}`);
    if (oe.value !== ne.value) diffs.push(`value "${oe.value ?? ''}" → "${ne.value ?? ''}"`);
    if (diffs.length) changed.push({ element: ne, detail: diffs.join(', ') });
  }
  return { removed, changed };
}

export interface BuildExplorationEventParams {
  kind: 'initial-load' | 'action';
  message: string;
  actingElement: ElementRecord | null;
  before: ScreenScan | null;
  after: ScreenScan;
  // The set of elementKey()s already known from EVERY prior step of this
  // session (not just `before`) — what actually decides "newly discovered"
  // vs. "revisiting a page we already scanned once."
  seenBeforeThisEvent: Set<string>;
  totalElementsSoFar: number;
  pagesVisitedSoFar: number;
}

export function buildExplorationEvent(params: BuildExplorationEventParams): ExplorationEvent {
  const { kind, message, actingElement, before, after, seenBeforeThisEvent, totalElementsSoFar, pagesVisitedSoFar } = params;
  const navigated = before !== null && before.url !== after.url;
  const added = after.elements.filter(el => !seenBeforeThisEvent.has(elementKey(after.url, el)));
  // Comparing two different pages field-by-field isn't a real diff (see
  // diffScansSafe's identical reasoning) — only compute removed/changed
  // when this step stayed on the same page as the one before it.
  const { removed, changed } = before && !navigated ? diffSamePage(before, after) : { removed: [], changed: [] };

  return {
    kind,
    timestamp: after.scannedAt,
    message,
    actingElement,
    previousUrl: before?.url ?? null,
    newUrl: after.url,
    navigated,
    added,
    removed,
    changed,
    totalElementsSoFar,
    pagesVisitedSoFar,
  };
}
