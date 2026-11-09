import type { ElementRecord } from '../types';

export interface ElementCluster {
  key: string;
  label: string;
  elements: ElementRecord[];
}

// Same parent chain + tag + exact class list => "the same repeated row
// shape." cssPath already does :nth-of-type sibling counting (scan.ts), so
// stripping the element's own trailing segment leaves a key that's shared by
// every member of a repeated list/table, but distinct from an unrelated
// repeated structure elsewhere on the page.
function clusterKey(el: ElementRecord): string {
  const segments = el.cssPath.split(' > ');
  const parentPrefix = segments.slice(0, -1).join(' > ');
  const sortedClasses = [...el.classes].sort().join('.');
  return `${parentPrefix}::${el.tag}::${sortedClasses}`;
}

// Only custom-interactive widgets (e.g. a clickable result row picked up via
// tabindex/role) or literal table/list-item tags are cluster *candidates* —
// native form controls (input/select/textarea/button) are never clustered,
// even if there happen to be 4+ of them, since a repeated group of
// checkboxes/radios is deliberate form structure, not a data collection.
function isClusterCandidate(el: ElementRecord): boolean {
  return el.isCustomInteractive || el.tag === 'tr' || el.tag === 'li';
}

function deriveLabel(members: ElementRecord[]): string {
  const tag = members[0].tag;
  const noun = tag === 'tr' ? 'rows' : tag === 'li' ? 'items' : 'elements';
  return `${members.length} ${noun}`;
}

// Operates on ONE already-grouped bucket (a single DOM group or category),
// not the whole scan — a repeated shape in one group shouldn't cluster with
// a coincidentally-identical shape in a different group.
export function detectCollections(elements: ElementRecord[], threshold = 4): ElementCluster[] {
  const buckets = new Map<string, ElementRecord[]>();
  for (const el of elements) {
    if (!isClusterCandidate(el)) continue;
    const key = clusterKey(el);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(el);
  }

  const clusters: ElementCluster[] = [];
  for (const [key, members] of buckets) {
    if (members.length < threshold) continue;
    clusters.push({ key, label: deriveLabel(members), elements: members });
  }
  return clusters;
}
