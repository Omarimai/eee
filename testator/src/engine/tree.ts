/**
 * Pure, immutable helpers for the session-wide exploration tree ("View
 * exploration tree" in the main menu) — a map of every workspace/screen
 * visited and every meaningful action taken, as sibling branches rather
 * than a flat log. Unrelated to `exploration.ts`'s per-element event log
 * that a single screen's saved report is built from; this tree spans the
 * whole app session, keyed by arbitrary label paths, not elements.
 */
export interface TreeNode {
  id: string;
  label: string;
  children: TreeNode[];
}

export function createRoot(): TreeNode {
  return { id: 'root', label: 'Session', children: [] };
}

function cloneNode(node: TreeNode): TreeNode {
  return { ...node, children: node.children.map(cloneNode) };
}

function findOrCreateChild(node: TreeNode, label: string): TreeNode {
  let child = node.children.find(c => c.label === label);
  if (!child) {
    child = { id: crypto.randomUUID(), label, children: [] };
    node.children.push(child);
  }
  return child;
}

// Walks/creates nodes along path (skipping empty segments) without adding a
// leaf — used so just navigating somewhere shows up in the tree even before
// you've done anything there.
export function ensurePath(root: TreeNode, path: string[]): TreeNode {
  const clone = cloneNode(root);
  let node = clone;
  for (const label of path) {
    if (!label) continue;
    node = findOrCreateChild(node, label);
  }
  return clone;
}

// Same walk, then appends a leaf for a specific action taken at that point.
export function addLeaf(root: TreeNode, path: string[], message: string): TreeNode {
  const clone = cloneNode(root);
  let node = clone;
  for (const label of path) {
    if (!label) continue;
    node = findOrCreateChild(node, label);
  }
  node.children.push({ id: crypto.randomUUID(), label: message, children: [] });
  return clone;
}
