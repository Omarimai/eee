import type { ElementRecord } from '../types';
import { detectCollections, type ElementCluster } from '../engine/collections';
import { categorizeUngrouped, SEMANTIC_CATEGORY_ORDER } from '../engine/categorize';

// The single flattened view model the list renders and the cursor walks —
// replaces the old two-mode navigation (a full-screen group picker you had
// to drill into, vs. a separate flat element list) with one scrollable,
// collapsible tree where group/collection headers sit inline with their
// (expanded) contents.
export type Row =
  | { kind: 'group'; key: string; name: string; count: number; expanded: boolean }
  | { kind: 'cluster'; key: string; groupKey: string; label: string; count: number; expandState: 0 | 1 | 2 }
  | { kind: 'element'; key: string; el: ElementRecord; groupKey: string; clusterKey: string | null }
  | { kind: 'more'; key: string; groupKey: string; clusterKey: string; remaining: number };

export function matchesFilter(el: ElementRecord, filter: string): boolean {
  if (!filter.trim()) return true;
  const haystack = `${el.accessibleName || ''} ${el.id || ''} ${el.name || ''} ${el.tag}`.toLowerCase();
  return haystack.includes(filter.trim().toLowerCase());
}

interface Bucket {
  key: string;
  name: string;
  elements: ElementRecord[];
}

// DOM-based groupContext groups always come first, in first-seen order —
// they're real structure read off the page itself. Only elements with no
// groupContext (today's single "(ungrouped)" bucket) get sorted into the
// 6-category semantic fallback, appended afterward in fixed taxonomy order.
// `category:` namespaces the key so a DOM group literally named "Actions"
// can never collide with the semantic category "Actions".
function bucketElements(elements: ElementRecord[], clusterThreshold: number): Bucket[] {
  const domOrder: string[] = [];
  const domMap = new Map<string, ElementRecord[]>();
  const ungrouped: ElementRecord[] = [];
  for (const el of elements) {
    if (el.groupContext) {
      if (!domMap.has(el.groupContext)) {
        domMap.set(el.groupContext, []);
        domOrder.push(el.groupContext);
      }
      domMap.get(el.groupContext)!.push(el);
    } else {
      ungrouped.push(el);
    }
  }

  const buckets: Bucket[] = domOrder.map(name => ({ key: name, name, elements: domMap.get(name)! }));

  if (ungrouped.length) {
    // Cluster membership decides "Data & records" before anything else is
    // categorized — a repeated row shape is a data collection regardless of
    // what its own tag/action looks like in isolation.
    const clusters = detectCollections(ungrouped, clusterThreshold);
    const memberIndices = new Set<number>();
    for (const c of clusters) for (const el of c.elements) memberIndices.add(el.index);

    const categoryOf = categorizeUngrouped(ungrouped, memberIndices);
    const catMap = new Map<string, ElementRecord[]>();
    for (const el of ungrouped) {
      const cat = categoryOf.get(el.index)!;
      if (!catMap.has(cat)) catMap.set(cat, []);
      catMap.get(cat)!.push(el);
    }
    for (const cat of SEMANTIC_CATEGORY_ORDER) {
      const els = catMap.get(cat);
      if (els && els.length) buckets.push({ key: `category:${cat}`, name: cat, elements: els });
    }
  }

  return buckets;
}

// Pure structural lookup — independent of `expanded`/filter state — used by
// the fill-chain's auto-advance to decide whether the next fillable field is
// hidden behind a group (safe to auto-expand) or a cluster (a scale
// boundary that could be hundreds of rows; the chain should stop there).
export function locateElement(
  elements: ElementRecord[],
  index: number,
  clusterThreshold = 4
): { groupKey: string; clusterKey: string | null } | null {
  const buckets = bucketElements(elements, clusterThreshold);
  for (const bucket of buckets) {
    if (!bucket.elements.some(e => e.index === index)) continue;
    const clusters = detectCollections(bucket.elements, clusterThreshold);
    for (const c of clusters) {
      if (c.elements.some(e => e.index === index)) {
        return { groupKey: bucket.key, clusterKey: `${bucket.key}::cluster::${c.key}` };
      }
    }
    return { groupKey: bucket.key, clusterKey: null };
  }
  return null;
}

export function toggleExpandKey(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

// Two keys encode a cluster's 3 levels: the base key gates collapsed<->
// preview, `${key}::all` gates preview<->full.
export function setClusterLevel(set: Set<string>, clusterKey: string, level: 0 | 1 | 2): Set<string> {
  const next = new Set(set);
  if (level >= 1) next.add(clusterKey);
  else next.delete(clusterKey);
  if (level >= 2) next.add(`${clusterKey}::all`);
  else next.delete(`${clusterKey}::all`);
  return next;
}

export interface BuildRowsInput {
  elements: ElementRecord[];
  expanded: Set<string>;
  filter: string;
  collapseLimit?: number;
  clusterThreshold?: number;
  defaultExpandThreshold?: number;
}

export function buildRows(input: BuildRowsInput): Row[] {
  const { elements, expanded, filter, collapseLimit = 3, clusterThreshold = 4, defaultExpandThreshold = 10 } = input;
  const filterActive = filter.trim().length > 0;
  const rows: Row[] = [];
  const buckets = bucketElements(elements, clusterThreshold);

  for (const bucket of buckets) {
    // A search scans every bucket regardless of collapse state — a bucket
    // with zero matches is omitted entirely rather than just left collapsed.
    const bucketMatches = filterActive ? bucket.elements.filter(el => matchesFilter(el, filter)) : bucket.elements;
    if (filterActive && bucketMatches.length === 0) continue;

    const clusters = detectCollections(bucket.elements, clusterThreshold);
    const clusterOf = new Map<number, ElementCluster>();
    for (const c of clusters) for (const el of c.elements) clusterOf.set(el.index, c);

    // `expanded` records a TOGGLE from default, not an absolute state — a
    // small bucket defaults open, a large one defaults collapsed; pressing
    // Enter/→/← flips it either way.
    const defaultOpen = bucket.elements.length <= defaultExpandThreshold;
    const toggled = expanded.has(bucket.key);
    const groupOpen = filterActive ? true : toggled ? !defaultOpen : defaultOpen;

    rows.push({ kind: 'group', key: bucket.key, name: bucket.name, count: bucket.elements.length, expanded: groupOpen });
    if (!groupOpen) continue;

    const emitted = new Set<string>();
    for (const el of bucket.elements) {
      const cluster = clusterOf.get(el.index);
      if (cluster) {
        if (emitted.has(cluster.key)) continue;
        emitted.add(cluster.key);

        const members = filterActive ? cluster.elements.filter(m => matchesFilter(m, filter)) : cluster.elements;
        if (filterActive && members.length === 0) continue;

        const clusterRowKey = `${bucket.key}::cluster::${cluster.key}`;
        // Collections always default collapsed (level 0) regardless of
        // size — that's the entire point of clustering them in the first
        // place. Two keys give 3 levels: collapsed -> preview -> full.
        const expandState: 0 | 1 | 2 = filterActive
          ? 2
          : expanded.has(`${clusterRowKey}::all`)
          ? 2
          : expanded.has(clusterRowKey)
          ? 1
          : 0;

        rows.push({
          kind: 'cluster',
          key: clusterRowKey,
          groupKey: bucket.key,
          label: cluster.label,
          count: cluster.elements.length,
          expandState,
        });

        if (expandState >= 1) {
          const shown = expandState === 2 ? members : members.slice(0, collapseLimit);
          for (const m of shown) {
            rows.push({ kind: 'element', key: `el:${m.index}`, el: m, groupKey: bucket.key, clusterKey: clusterRowKey });
          }
          const remaining = members.length - shown.length;
          if (remaining > 0) {
            rows.push({ kind: 'more', key: `${clusterRowKey}::more`, groupKey: bucket.key, clusterKey: clusterRowKey, remaining });
          }
        }
        continue;
      }

      if (filterActive && !matchesFilter(el, filter)) continue;
      rows.push({ kind: 'element', key: `el:${el.index}`, el, groupKey: bucket.key, clusterKey: null });
    }
  }

  return rows;
}
