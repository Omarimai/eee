import fs from 'node:fs';
import path from 'node:path';
import { diffScansSafe } from './diff';
import type { Config, ScreenScan, DiffResult, ElementRecord, ExplorationEvent, SeenElementEntry } from '../types';

export function saveReport(
  scan: ScreenScan,
  config: Config,
  events: ExplorationEvent[] = [],
  allSeenElements: SeenElementEntry[] = []
): { reportPath: string; diff: DiffResult } {
  const dir = path.join(config.reportsDir, safe(scan.workspace), safe(scan.screen));
  fs.mkdirSync(dir, { recursive: true });

  const existing = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  const previous: ScreenScan | null = existing.length
    ? JSON.parse(fs.readFileSync(path.join(dir, existing[existing.length - 1]), 'utf8'))
    : null;
  const diff: DiffResult = previous ? diffScansSafe(previous, scan) : { previousScanAt: null, changes: [] };

  const timestamp = scan.scannedAt.replace(/[:.]/g, '-');
  const jsonPath = path.join(dir, `${timestamp}.json`);
  const txtPath = path.join(dir, `${timestamp}.txt`);

  // The .json snapshot (used for the next save's diff) stays just the
  // current scan — diffing is about "did this one page drift," which stops
  // meaning anything if it spans multiple different pages. The chronological
  // event log and the cumulative allSeenElements are purely additions to
  // the human-readable .txt.
  fs.writeFileSync(jsonPath, JSON.stringify(scan, null, 2));
  fs.writeFileSync(txtPath, renderNavigationReport(scan, diff, events, allSeenElements));

  updateHistoryIndex(scan, diff, config);

  return { reportPath: txtPath, diff };
}

function safe(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase();
}

function compactElementLine(el: ElementRecord): string {
  return el.accessibleName || el.id || el.name || `<${el.tag}>`;
}

// Shared by the complete element inventory — every element gets the exact
// same id/selector/confidence card. `indent` lets nested uses (none today,
// kept for symmetry with the rest of the renderer) offset further in.
function renderElementDetailLines(el: ElementRecord, indent: string): string[] {
  const lines: string[] = [];
  lines.push(`${indent}Tag: <${el.tag}${el.type ? ` type="${el.type}"` : ''}>`);
  if (el.groupContext) lines.push(`${indent}Group: ${el.groupContext}`);
  lines.push(
    `${indent}Visible: ${el.visible ? 'yes' : 'no'}   Disabled: ${el.disabled ? 'yes' : 'no'}   Required: ${
      el.required ? 'yes' : 'no'
    }   Readonly: ${el.readonly ? 'yes' : 'no'}`
  );
  lines.push(`${indent}Best selector: ${el.bestSelector.type}=${el.bestSelector.value} (confidence: ${el.bestSelector.confidence})`);
  lines.push(`${indent}All selectors:`);
  for (const s of el.selectors) {
    lines.push(`${indent}  - ${s.type.padEnd(12)} ${s.value.padEnd(32)} ${s.confidence}`);
  }
  if (!el.id) lines.push(`${indent}⚠ No id present`);
  lines.push(`${indent}Available actions: ${el.availableActions.join(', ') || 'none'}`);
  if (el.value !== null && el.value !== '') lines.push(`${indent}Value: "${el.value}"`);
  if (el.note) lines.push(`${indent}Note: ${el.note}`);
  return lines;
}

// A timeline step's discovered elements are shown as compact bullets (name
// only) — the spec's own example does this too. Full id/selector detail for
// every one of them still lives in the complete inventory section below;
// repeating it per step would make the timeline unreadable. Grouped by
// groupContext when at least one real (non-"(ungrouped)") section exists —
// exactly mirroring what the live Explorer itself shows for a page.
function renderAddedList(elements: ElementRecord[], indent: string): string[] {
  const lines: string[] = [];
  const order: string[] = [];
  const byGroup = new Map<string, ElementRecord[]>();
  for (const el of elements) {
    const key = el.groupContext || '(ungrouped)';
    if (!byGroup.has(key)) {
      byGroup.set(key, []);
      order.push(key);
    }
    byGroup.get(key)!.push(el);
  }
  const hasRealGroup = order.some(k => k !== '(ungrouped)');
  if (hasRealGroup) {
    // Real section names first, "(ungrouped)" catch-all last — nav links
    // and page-level buttons tend to appear earliest in DOM order with no
    // group of their own, which would otherwise shove them ahead of the
    // actual named sections a reader cares about more.
    const sortedKeys = [...order.filter(k => k !== '(ungrouped)'), ...order.filter(k => k === '(ungrouped)')];
    for (const key of sortedKeys) {
      lines.push(`${indent}${key}:`);
      for (const el of byGroup.get(key)!) lines.push(`${indent}  - ${compactElementLine(el)}`);
    }
  } else {
    for (const el of elements) lines.push(`${indent}- ${compactElementLine(el)}`);
  }
  return lines;
}

function renderOverview(events: ExplorationEvent[]): string[] {
  const lines: string[] = [];
  const first = events[0];
  const last = events[events.length - 1];
  const interactions = events.filter(e => e.kind === 'action').length;
  const navigations = events.filter(e => e.navigated).length;
  lines.push('EXPLORATION OVERVIEW');
  lines.push(`  Starting URL: ${first ? first.newUrl : '(no scan recorded)'}`);
  lines.push(`  Pages visited: ${last ? last.pagesVisitedSoFar : 0}`);
  lines.push(`  Total unique elements discovered: ${last ? last.totalElementsSoFar : 0}`);
  lines.push(`  Total interactions performed: ${interactions}`);
  lines.push(`  Total navigation transitions: ${navigations}`);
  return lines;
}

// The report's central section: replaying `events` in order IS the report —
// never reconstructed from a single final DOM snapshot. Every step says
// what was done, whether it stayed on the same page or navigated to a new
// one, exactly what that caused (never more than the captured before/after
// scans actually establish), and the running totals after it.
function renderTimeline(events: ExplorationEvent[]): string[] {
  const lines: string[] = [];
  events.forEach((event, i) => {
    const stepNum = i + 1;
    lines.push(`Step ${stepNum} — ${event.message}`);

    if (event.kind === 'action' && event.actingElement) {
      const el = event.actingElement;
      lines.push(`  Acting element: ${compactElementLine(el)} (${el.bestSelector.type}=${el.bestSelector.value}, confidence: ${el.bestSelector.confidence})`);
    }

    if (event.kind === 'initial-load') {
      lines.push(`  URL: ${event.newUrl}`);
      lines.push(`  Elements discovered: ${event.added.length}`);
      if (event.added.length) {
        lines.push('  Elements on this page:');
        lines.push(...renderAddedList(event.added, '    '));
      }
    } else if (event.navigated) {
      lines.push(`  Navigation: ${event.previousUrl} → ${event.newUrl}`);
      lines.push('  New page loaded (same screen).');
      lines.push(`  Elements discovered: ${event.added.length}`);
      if (event.added.length) {
        lines.push('  New elements, grouped by section:');
        lines.push(...renderAddedList(event.added, '    '));
      }
    } else {
      lines.push(`  URL: unchanged (${event.newUrl})`);
      const hasChange = event.added.length || event.removed.length || event.changed.length;
      if (!hasChange) {
        // Rule: never imply an action did something the captured snapshots
        // don't actually show — say plainly when nothing detectably changed.
        lines.push('  UI change: No UI change detected.');
      } else {
        const parts: string[] = [];
        if (event.added.length) parts.push(`${event.added.length} new element${event.added.length === 1 ? '' : 's'} appeared`);
        if (event.removed.length) parts.push(`${event.removed.length} element${event.removed.length === 1 ? '' : 's'} disappeared`);
        if (event.changed.length) parts.push(`${event.changed.length} element${event.changed.length === 1 ? '' : 's'} changed`);
        lines.push(`  UI change: ${parts.join(', ')}.`);
        if (event.added.length) {
          lines.push('  New elements:');
          lines.push(...renderAddedList(event.added, '    '));
        }
        if (event.removed.length) {
          lines.push('  Removed elements:');
          for (const el of event.removed) lines.push(`    - ${compactElementLine(el)}`);
        }
        if (event.changed.length) {
          lines.push('  Changed elements:');
          for (const c of event.changed) lines.push(`    - ${compactElementLine(c.element)} — ${c.detail}`);
        }
      }
    }

    lines.push(`  Running total: ${event.totalElementsSoFar} elements across ${event.pagesVisitedSoFar} page${event.pagesVisitedSoFar === 1 ? '' : 's'} (same screen)`);
    lines.push('');
  });
  return lines;
}

interface GraphNode {
  label: string;
  children: GraphNode[];
}

// Reflects actual navigation and interactions taken this session — never
// hypothetical/inferred application structure. The root is the one screen
// this whole report is about (Cases, Users, ...); a straight chain of
// action -> (new page within it | what appeared) -> ..., with a navigated
// page's distinct UI sections listed as its leaves. Navigating never
// creates a new "screen" node — a screen is fixed for the whole report,
// only the page (URL) within it changes.
function buildGraph(events: ExplorationEvent[], rootLabel: string): GraphNode {
  const root: GraphNode = { label: rootLabel, children: [] };
  let currentPage = root;
  for (let i = 1; i < events.length; i++) {
    const event = events[i];
    const actionNode: GraphNode = { label: event.message, children: [] };
    currentPage.children.push(actionNode);
    if (event.navigated) {
      const pageNode: GraphNode = { label: event.newUrl, children: [] };
      actionNode.children.push(pageNode);
      const sections = Array.from(new Set(event.added.map(el => el.groupContext).filter((g): g is string => !!g)));
      for (const section of sections) pageNode.children.push({ label: section, children: [] });
      currentPage = pageNode;
    } else if (event.added.length) {
      actionNode.children.push({
        label: `${event.added.length} new element${event.added.length === 1 ? '' : 's'} appeared`,
        children: [],
      });
    }
  }
  return root;
}

function renderGraphNode(node: GraphNode, prefix: string, isLast: boolean, isRoot: boolean): string[] {
  const lines: string[] = [];
  lines.push(isRoot ? node.label : `${prefix}${isLast ? '└── ' : '├── '}${node.label}`);
  const childPrefix = isRoot ? '  ' : prefix + (isLast ? '    ' : '│   ');
  node.children.forEach((child, i) => {
    lines.push(...renderGraphNode(child, childPrefix, i === node.children.length - 1, false));
  });
  return lines;
}

function renderNavigationReport(
  scan: ScreenScan,
  diff: DiffResult,
  events: ExplorationEvent[],
  allSeenElements: SeenElementEntry[]
): string {
  const lines: string[] = [];
  lines.push('TESTATOR NAVIGATION REPORT');
  lines.push(`Screen: ${scan.workspace} > ${scan.screen}`);
  lines.push(`Scanned: ${scan.scannedAt}`);
  lines.push('');

  lines.push(...renderOverview(events));
  lines.push('');

  lines.push('-'.repeat(60));
  lines.push('NAVIGATION TIMELINE');
  lines.push('-'.repeat(60));
  lines.push('');
  if (events.length) {
    lines.push(...renderTimeline(events));
  } else {
    lines.push('(no exploration events recorded for this screen yet)');
    lines.push('');
  }

  lines.push('-'.repeat(60));
  lines.push('NAVIGATION GRAPH');
  lines.push('-'.repeat(60));
  lines.push('');
  if (events.length) {
    lines.push(...renderGraphNode(buildGraph(events, `${scan.workspace} > ${scan.screen}`), '', true, true));
  } else {
    lines.push('(nothing explored yet)');
  }
  lines.push('');

  // Secondary, reference-only: the complete inventory, id/selector/confidence
  // and all, for every element discovered this session across every page —
  // kept deliberately below the timeline rather than leading with it (rule:
  // "keep the inventory accessible, but secondary to the timeline").
  lines.push('-'.repeat(60));
  lines.push('COMPLETE ELEMENT INVENTORY (reference — full detail for every element');
  lines.push('discovered this session, across every page)');
  lines.push('-'.repeat(60));

  let counter = 0;
  const pushElement = (el: ElementRecord) => {
    counter++;
    lines.push('');
    lines.push(`[${counter}] ${el.accessibleName || el.id || el.name || '(unlabeled)'}`);
    lines.push(...renderElementDetailLines(el, '  '));
  };

  const pageUrls = Array.from(new Set(allSeenElements.map(e => e.url)));
  if (allSeenElements.length) {
    for (const pageUrl of pageUrls) {
      lines.push('');
      lines.push(`=== Page: ${pageUrl} ===`);
      for (const entry of allSeenElements) {
        if (entry.url === pageUrl) pushElement(entry.element);
      }
    }
  } else {
    scan.elements.forEach(pushElement);
  }

  if (scan.suggestedFlows.length) {
    lines.push('');
    lines.push('Suggested flows:');
    for (const f of scan.suggestedFlows) lines.push(`  - ${f}`);
  }

  lines.push('');
  lines.push('-'.repeat(60));

  if (diff.previousScanAt) {
    lines.push(`CHANGES SINCE LAST SCAN (${diff.previousScanAt})`);
    const navigation = diff.changes.find(c => c.type === 'navigated');
    if (navigation) {
      // A navigation-caused diff is one note, not a bulleted added/removed
      // flood — the old page's fields didn't vanish, this is just a
      // different page within the same screen (see diffScansSafe).
      lines.push(`  → ${navigation.message}`);
    } else if (diff.changes.length === 0) {
      lines.push('  No changes detected.');
    } else {
      for (const c of diff.changes) {
        const prefix =
          c.type === 'added'
            ? '+ ADDED: '
            : c.type === 'removed'
            ? '- REMOVED: '
            : c.type === 'low-confidence-match'
            ? '⚠ LOW CONFIDENCE: '
            : '~ CHANGED: ';
        lines.push(`  ${prefix}${c.message}`);
      }
    }
  } else {
    lines.push('No previous scan to compare against — this is the first scan of this screen.');
  }

  return lines.join('\n');
}

function updateHistoryIndex(scan: ScreenScan, diff: DiffResult, config: Config) {
  const dir = path.join(config.historyDir, safe(scan.workspace), safe(scan.screen));
  fs.mkdirSync(dir, { recursive: true });
  const indexPath = path.join(dir, 'index.json');
  const index = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : [];
  index.push({
    timestamp: scan.scannedAt,
    elementsFound: scan.elements.length,
    changed: diff.changes.filter(c => c.type === 'changed' || c.type === 'low-confidence-match').length,
    added: diff.changes.filter(c => c.type === 'added').length,
    removed: diff.changes.filter(c => c.type === 'removed').length,
  });
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}
