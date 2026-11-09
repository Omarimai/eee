import { useRef } from 'react';
import { elementKey, buildExplorationEvent } from '../engine/exploration';
import type { ElementRecord, ExplorationEvent, ScreenScan, SeenElementEntry } from '../types';

/**
 * Owns the whole session's exploration history for one screen — every
 * element ever seen (across however many pages were visited) and the
 * chronological event log the saved report's navigation timeline/graph are
 * built from. Nothing in the live UI reads from this, so it's refs rather
 * than state: no pointless re-renders, and no risk of an async action
 * reading a stale snapshot of its own bookkeeping.
 */
export function useExplorationLog() {
  const seenElementsRef = useRef<Map<string, SeenElementEntry>>(new Map());
  const visitedUrlsRef = useRef<Set<string>>(new Set());
  const eventsRef = useRef<ExplorationEvent[]>([]);

  /**
   * Records one step: pairs the scan taken right before an action (`before`,
   * `null` only for the very first "initial-load" scan) with the one taken
   * right after it settled (`after`), then lets `buildExplorationEvent`
   * work out what actually changed — never inferred from the final state
   * alone. `actingElement` is the element the action was performed on, or
   * `null` for actions with no single element behind them.
   */
  const recordEvent = (
    kind: 'initial-load' | 'action',
    message: string,
    actingElement: ElementRecord | null,
    before: ScreenScan | null,
    after: ScreenScan
  ) => {
    const seenBeforeThisEvent = new Set(seenElementsRef.current.keys());
    for (const el of after.elements) {
      seenElementsRef.current.set(elementKey(after.url, el), { url: after.url, element: el });
    }
    visitedUrlsRef.current.add(after.url);
    eventsRef.current.push(
      buildExplorationEvent({
        kind,
        message,
        actingElement,
        before,
        after,
        seenBeforeThisEvent,
        totalElementsSoFar: seenElementsRef.current.size,
        pagesVisitedSoFar: visitedUrlsRef.current.size,
      })
    );
  };

  const getAllSeenElements = (): SeenElementEntry[] => Array.from(seenElementsRef.current.values());
  const getEvents = (): ExplorationEvent[] => eventsRef.current;

  return { recordEvent, getAllSeenElements, getEvents };
}
