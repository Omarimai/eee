import React, { useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { Page } from 'playwright';
import { StatusBar } from '../components/StatusBar';
import { scanScreen } from '../engine/scan';
import { saveReport } from '../engine/report';
import { tryElement, fillElement } from '../engine/interact';
import { diffScansSafe, summarizeRescan } from '../engine/diff';
import { elementKey, buildExplorationEvent } from '../engine/exploration';
import { deriveConfidence, confidenceGlyph, confidenceLabel } from '../engine/confidence';
import { buildRows, matchesFilter, locateElement, toggleExpandKey, setClusterLevel, type Row } from './elementExplorerRows';
import type { Config, ElementRecord, ScreenScan, DiffResult, RescanSummary, ExplorationEvent, SeenElementEntry } from '../types';

// "No id present" only matters for elements you'd actually want to select by
// id for automation — form fields. Flagging it on every button/link/result
// row (which were never going to have one) just drowns out the signal.
function isFormField(el: ElementRecord): boolean {
  return el.availableActions.some(a =>
    ['fill', 'selectOption', 'selectOptions', 'check', 'uncheck', 'toggle', 'setValue', 'setInputFiles'].includes(a)
  );
}

const FILL_ACTIONS = ['fill', 'selectOption', 'selectOptions'];
const FILL_LIKE_ACTIONS = ['fill', 'selectOption', 'selectOptions', 'check', 'uncheck', 'toggle', 'setValue'];

// "Clicked Search" on its own doesn't say what was actually searched for —
// whether the values that got typed came from testator's own fill prompt or
// from someone typing straight into the real browser window (both are valid
// ways to drive it), the CURRENT values of the clicked element's form-mates
// are already sitting right there in the scan. Pulling them in turns a
// content-free "Clicked Search" into "Clicked Search — Case ref/merchant:
// Pixel Forge, Status: escalated", so the action trail stays meaningful
// regardless of how those fields actually got filled.
function describeFormContext(el: ElementRecord, elements: ElementRecord[]): string {
  if (!el.formId) return '';
  const parts = elements
    .filter(e => e.formId === el.formId && e.index !== el.index && e.value && FILL_LIKE_ACTIONS.some(a => e.availableActions.includes(a)))
    .map(e => `${e.accessibleName || e.id || e.name || e.tag}: ${e.value}`);
  return parts.length ? ` — ${parts.join(', ')}` : '';
}

interface Props {
  page: Page;
  config: Config;
  workspace: string;
  workspaceLabel: string;
  screen: string;
  onBack: () => void;
  onActivity: (message: string, pathOverride?: string[]) => void;
  onNavigate: (path: string[]) => void;
}

export function ElementExplorer({ page, config, workspace, workspaceLabel, screen, onBack, onActivity }: Props) {
  const [status, setStatus] = useState('Scanning DOM…');
  const [scan, setScan] = useState<ScreenScan | null>(null);
  const [filter, setFilter] = useState('');
  const [filtering, setFiltering] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [noting, setNoting] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [filling, setFilling] = useState(false);
  const [fillDraft, setFillDraft] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selectCursor, setSelectCursor] = useState(0);
  const [multiSelectDraft, setMultiSelectDraft] = useState<Set<string>>(new Set());
  const [inspecting, setInspecting] = useState(false);
  const [rescanOverlay, setRescanOverlay] = useState<{ diff: DiffResult; summary: RescanSummary } | null>(null);
  // These three accumulate the whole session's exploration history for the
  // saved report, not the live UI — nothing in the render tree depends on
  // them, so refs avoid pointless re-renders and (more importantly) avoid
  // any risk of an async action reading a stale state snapshot of its own.
  const seenElementsRef = useRef<Map<string, SeenElementEntry>>(new Map());
  const visitedUrlsRef = useRef<Set<string>>(new Set());
  const explorationEventsRef = useRef<ExplorationEvent[]>([]);

  const currentTreePath = () => [workspaceLabel, screen];

  // The report is reconstructed from this chronological event log, never
  // from just the final DOM snapshot — each event pairs the scan taken
  // right before an action with the one taken right after it settled, so
  // "what's new / what's gone / what moved to a different page" is a real
  // computed fact, not an inference from whatever's on screen at save time.
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
    explorationEventsRef.current.push(
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

  const runScan = (): Promise<ScreenScan | null> => {
    setStatus('Scanning DOM…');
    const previousUrl = scan?.url;
    return scanScreen(page, workspace, screen, config)
      .then(result => {
        setScan(result);
        // A fresh scan can change the row count/shape out from under the
        // cursor (a search narrows results, a group collapses). Always
        // start a new scan's result at the top rather than risk landing
        // past the end of the new list with no indication why.
        setCursor(0);
        // Activating a row (or any in-page navigation) can swap in a whole
        // new sub-page's content under the same screen/component — a filter
        // scoped to the OLD page's labels then silently matches nothing on
        // the new one, showing an empty list with no visible explanation.
        // The URL actually changing is the reliable signal that happened.
        if (previousUrl !== undefined && result.url !== previousUrl && filter) {
          setFilter('');
        }
        setStatus(`Ready — ${result.elements.length} elements found`);
        onActivity(`Scanned ${workspace} › ${screen} — ${result.elements.length} elements`, currentTreePath());
        return result;
      })
      .catch(err => {
        setStatus(`Error: ${err.message}`);
        return null;
      });
  };

  React.useEffect(() => {
    (async () => {
      const result = await runScan();
      if (result) recordEvent('initial-load', 'Initial screen loaded', null, null, result);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows: Row[] = buildRows({ elements: scan?.elements || [], expanded, filter });

  React.useEffect(() => {
    setCursor(0);
  }, [filter]);

  const groupCount = rows.filter(r => r.kind === 'group').length;

  const saveCurrentReport = () => {
    if (!scan) return;
    setStatus('Comparing against last scan…');
    const annotated: ScreenScan = {
      ...scan,
      elements: scan.elements.map(el => ({ ...el, note: notes[elementKey(scan.url, el)] || null })),
    };
    const allSeenElements: SeenElementEntry[] = Array.from(seenElementsRef.current.values()).map(entry => ({
      url: entry.url,
      element: { ...entry.element, note: notes[elementKey(entry.url, entry.element)] || entry.element.note || null },
    }));
    setStatus('Writing report…');
    const { reportPath, diff } = saveReport(annotated, config, explorationEventsRef.current, allSeenElements);
    setSaved(reportPath);
    setStatus(`Saved — ${diff.changes.length} change(s) since last scan`);
    onActivity(`Saved report for ${workspace} › ${screen} — ${diff.changes.length} change(s) since last scan`, currentTreePath());
  };

  // Rescanning is the one action that intentionally does NOT auto-rescan
  // again afterward (it already *is* the rescan) — instead it diffs against
  // whatever was on screen immediately before, live, so you see what moved
  // without needing to save a report first. Auto-rescans after an
  // action/fill (below, and in submitFillLike) deliberately skip this —
  // showing this overlay after every single click would be unbearable.
  const rescanWithDiff = async () => {
    const previousInMemory = scan;
    const result = await runScan();
    if (previousInMemory && result) {
      recordEvent('action', 'Rescanned manually', null, previousInMemory, result);
      const diff = diffScansSafe(previousInMemory, result);
      if (diff.changes[0]?.type === 'navigated') {
        // A list -> detail (or back) navigation within this same screen —
        // not a field-level regression to review. What actually happened is
        // already in the action trail, so just say so instead of opening
        // the full added/removed overlay for a comparison that isn't real.
        setStatus('Rescanned — navigated to a different page within this screen (see the activity log for what happened)');
        return;
      }
      const summary = summarizeRescan(diff, result.elements.length);
      if (summary.added || summary.removed || summary.changed) {
        setRescanOverlay({ diff, summary });
      } else {
        setStatus(`Rescanned — no changes (${result.elements.length} elements)`);
      }
    }
  };

  // A <select> already has a known, exact set of valid values — asking for
  // free-typed text that has to match one of them letter-for-letter is just
  // setting the tester up to mistype it. Only fall back to free text when
  // there's genuinely nothing to pick from.
  const openPromptFor = (el: ElementRecord) => {
    if (FILL_ACTIONS.some(a => el.availableActions.includes(a)) && el.options && el.options.length > 0) {
      const startAt = el.options.findIndex(o => el.selectedValues?.includes(o.value));
      setSelectCursor(Math.max(0, startAt));
      setMultiSelectDraft(new Set(el.selectedValues || []));
      setSelecting(true);
      return;
    }
    setFillDraft(el.value || '');
    setFilling(true);
  };

  // Auto-chain: filling a whole form shouldn't mean navigating back out to
  // the list and back in for every field. Groups are a readability
  // boundary only — auto-expanding one to reach the next field is exactly
  // what removes the friction this chain exists for. Clusters are a scale
  // boundary (could be hundreds of rows) — silently materializing them as a
  // side effect of pressing Enter would be a surprising, possibly expensive
  // UI event, so the chain stops there and explains why instead.
  const advanceChain = (result: ScreenScan, afterIndex: number) => {
    const next = result.elements.find(
      e => e.index > afterIndex && FILL_ACTIONS.some(a => e.availableActions.includes(a)) && matchesFilter(e, filter)
    );
    if (!next) return;

    const directRows = buildRows({ elements: result.elements, expanded, filter });
    const directPos = directRows.findIndex(r => r.kind === 'element' && r.el.index === next.index);
    if (directPos !== -1) {
      setCursor(directPos);
      openPromptFor(next);
      return;
    }

    const location = locateElement(result.elements, next.index);
    if (!location) return;

    const groupRow = directRows.find(r => r.kind === 'group' && r.key === location.groupKey);
    const groupCurrentlyOpen = groupRow?.kind === 'group' ? groupRow.expanded : false;
    const effectiveExpanded = groupCurrentlyOpen ? expanded : toggleExpandKey(expanded, location.groupKey);

    const rowsWithGroupOpen = buildRows({ elements: result.elements, expanded: effectiveExpanded, filter });
    const posWithGroupOpen = rowsWithGroupOpen.findIndex(r => r.kind === 'element' && r.el.index === next.index);
    if (posWithGroupOpen !== -1) {
      setExpanded(effectiveExpanded);
      setCursor(posWithGroupOpen);
      openPromptFor(next);
      return;
    }

    if (effectiveExpanded !== expanded) setExpanded(effectiveExpanded);
    const clusterPos = rowsWithGroupOpen.findIndex(r => r.key === location.clusterKey);
    if (clusterPos !== -1) setCursor(clusterPos);
    setStatus(`Next fillable field is inside a collapsed collection — press → to continue`);
  };

  // Shared by the free-text prompt's submit and the option picker's confirm
  // — same fill/settle/rescan/chain sequence either way, only how the value
  // was obtained differs.
  const submitFillLike = (el: ElementRecord, value: string | string[]) => {
    setFilling(false);
    setSelecting(false);
    setActing(true);
    setStatus(`Filling "${el.accessibleName || el.id || el.tag}"…`);
    const before = scan;
    (async () => {
      try {
        const message = await fillElement(page, el, config.selectors.contentRegion, value);
        setStatus(`${message} — settling before rescan…`);
        await new Promise(r => setTimeout(r, 400));
        const result = await runScan();
        if (result) {
          recordEvent('action', message, el, before, result);
          advanceChain(result, el.index);
        }
      } catch (err) {
        setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setActing(false);
      }
    })();
  };

  useInput((input, key) => {
    if (rescanOverlay) {
      if (key.escape || input === 'q') setRescanOverlay(null);
      return;
    }
    if (key.escape) {
      if (filtering) {
        setFiltering(false);
        return;
      }
      if (filling) {
        setFilling(false);
        return;
      }
      if (selecting) {
        setSelecting(false);
        return;
      }
      if (noting) {
        setNoting(false);
        return;
      }
      if (inspecting) {
        setInspecting(false);
        return;
      }
      if (filter) {
        setFilter('');
        return;
      }
      onBack();
      return;
    }
    if (selecting) {
      const row = rows[cursor];
      const el = row?.kind === 'element' ? row.el : undefined;
      if (!el || !el.options) {
        setSelecting(false);
        return;
      }
      if (key.upArrow) setSelectCursor(c => Math.max(0, c - 1));
      else if (key.downArrow) setSelectCursor(c => Math.min(el.options!.length - 1, c + 1));
      else if (input === ' ' && el.multiple) {
        const opt = el.options[selectCursor];
        if (opt) {
          setMultiSelectDraft(prev => {
            const next = new Set(prev);
            if (next.has(opt.value)) next.delete(opt.value);
            else next.add(opt.value);
            return next;
          });
        }
      } else if (key.return) {
        if (el.multiple) {
          submitFillLike(el, Array.from(multiSelectDraft));
        } else {
          const opt = el.options[selectCursor];
          if (opt) submitFillLike(el, opt.value);
        }
      }
      return;
    }
    if (inspecting) {
      if (input === 'i') setInspecting(false);
      return;
    }
    if (filtering || noting || filling || acting) return;

    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    else if (key.downArrow) setCursor(c => Math.min(rows.length - 1, c + 1));
    else if (input === '/') setFiltering(true);
    else if (key.leftArrow || key.rightArrow) {
      const row = rows[cursor];
      if (!row) return;
      if (row.kind === 'group') {
        if (key.rightArrow && !row.expanded) setExpanded(prev => toggleExpandKey(prev, row.key));
        else if (key.leftArrow && row.expanded) setExpanded(prev => toggleExpandKey(prev, row.key));
      } else if (row.kind === 'cluster') {
        if (key.rightArrow && row.expandState < 2) {
          setExpanded(prev => setClusterLevel(prev, row.key, (row.expandState + 1) as 0 | 1 | 2));
        } else if (key.leftArrow && row.expandState > 0) {
          setExpanded(prev => setClusterLevel(prev, row.key, (row.expandState - 1) as 0 | 1 | 2));
        }
      } else if (row.kind === 'more') {
        if (key.rightArrow) setExpanded(prev => setClusterLevel(prev, row.clusterKey, 2));
        else if (key.leftArrow) {
          const headerPos = rows.findIndex(r => r.key === row.clusterKey);
          if (headerPos !== -1) setCursor(headerPos);
        }
      } else if (row.kind === 'element' && key.leftArrow) {
        const ownerKey = row.clusterKey || row.groupKey;
        if (row.clusterKey) setExpanded(prev => setClusterLevel(prev, row.clusterKey!, 0));
        else setExpanded(prev => toggleExpandKey(prev, row.groupKey));
        const headerPos = rows.findIndex(r => r.key === ownerKey);
        if (headerPos !== -1) setCursor(headerPos);
      }
    } else if (key.return) {
      const row = rows[cursor];
      if (!row) return;
      if (row.kind === 'group') {
        setExpanded(prev => toggleExpandKey(prev, row.key));
        return;
      }
      if (row.kind === 'cluster') {
        const nextLevel = row.expandState === 2 ? 0 : ((row.expandState + 1) as 0 | 1 | 2);
        setExpanded(prev => setClusterLevel(prev, row.key, nextLevel));
        return;
      }
      if (row.kind === 'more') {
        setExpanded(prev => setClusterLevel(prev, row.clusterKey, 2));
        return;
      }
      // Enter is the one "do the thing" key — fill/select for a form field,
      // click/toggle/activate otherwise. Acting on something is itself a
      // strong enough signal it mattered for the exploration log; there's
      // no separate inclusion flag anymore because every scanned element is
      // already in the report regardless.
      const el = row.el;
      if (FILL_ACTIONS.some(a => el.availableActions.includes(a))) {
        openPromptFor(el);
        return;
      }
      if (el.availableActions.length === 0) {
        setStatus(`"${el.accessibleName || el.id || el.tag}" has nothing to act on`);
        return;
      }
      setActing(true);
      setStatus(`Trying "${el.accessibleName || el.id || el.tag}" in the browser…`);
      const before = scan;
      (async () => {
        try {
          const message = await tryElement(page, el, config.selectors.contentRegion);
          // The click/activation event firing doesn't mean the app's own
          // async work (API delay, re-render) is done — give it a moment to
          // settle before trusting the DOM again, or the rescan races ahead
          // and silently captures stale content.
          setStatus(`${message} — settling before rescan…`);
          await new Promise(r => setTimeout(r, 400));
          const result = await runScan();
          if (result) {
            recordEvent('action', message + describeFormContext(el, before?.elements || []), el, before, result);
          }
        } catch (err) {
          setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          setActing(false);
        }
      })();
    } else if (input === 'i') {
      const row = rows[cursor];
      if (row?.kind === 'element') setInspecting(true);
    } else if (input === 'r') {
      rescanWithDiff();
    } else if (input === 'n') {
      const row = rows[cursor];
      if (row?.kind !== 'element') return;
      setNoteDraft(notes[elementKey(scan?.url ?? '', row.el)] || '');
      setNoting(true);
    } else if (input === 's') {
      saveCurrentReport();
    } else if (input === 'q') {
      onBack();
    }
  });

  const highlightedRow = rows[cursor];

  // Ink doesn't scroll a Box to follow anything — it just prints every row
  // and lets the real terminal scroll past whatever doesn't fit. On a big
  // list that means the cursor can scroll off the top/bottom of the visible
  // window with nothing on screen to show where it went. Window the list
  // around the cursor instead of rendering all of `rows` unconditionally.
  const visibleRows = Math.max(5, (process.stdout.rows || 24) - 10);
  const viewportStart =
    rows.length <= visibleRows
      ? 0
      : Math.min(Math.max(0, cursor - Math.floor(visibleRows / 2)), rows.length - visibleRows);
  const visibleSlice = rows.slice(viewportStart, viewportStart + visibleRows);
  const hiddenAbove = viewportStart;
  const hiddenBelow = rows.length - viewportStart - visibleSlice.length;
  const highlighted = highlightedRow?.kind === 'element' ? highlightedRow.el : undefined;

  if (rescanOverlay) {
    const { summary, diff } = rescanOverlay;
    const shown = diff.changes.slice(0, 15);
    const more = diff.changes.length - shown.length;
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <Text bold>RESCAN RESULTS · {screen}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text color="green">+ {summary.added} new element{summary.added === 1 ? '' : 's'}</Text>
          <Text color="red">- {summary.removed} removed element{summary.removed === 1 ? '' : 's'}</Text>
          <Text color="yellow">~ {summary.changed} modified element{summary.changed === 1 ? '' : 's'}</Text>
          <Text dimColor>= {summary.unchanged} unchanged element{summary.unchanged === 1 ? '' : 's'}</Text>
        </Box>
        {shown.length > 0 && (
          <Box marginTop={1} flexDirection="column">
            <Text bold>CHANGES</Text>
            {shown.map((c, i) => {
              const prefix =
                c.type === 'added' ? '+ ' : c.type === 'removed' ? '- ' : c.type === 'low-confidence-match' ? '⚠ ' : '~ ';
              const color = c.type === 'added' ? 'green' : c.type === 'removed' ? 'red' : 'yellow';
              return (
                <Text key={i} color={color} wrap="truncate-end">
                  {prefix}
                  {c.label || c.message}
                </Text>
              );
            })}
            {more > 0 && <Text dimColor>...{more} more (see saved report)</Text>}
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>Esc/q close · s save report</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" paddingX={1}>
        <Text bold>
          {workspace} › {screen} › Explorer
        </Text>
        <Text dimColor>
          {scan?.elements.length ?? 0} elements discovered · {groupCount} group{groupCount === 1 ? '' : 's'} · All
          elements automatically included
        </Text>
      </Box>
      <Box flexGrow={1} paddingX={1}>
        <Box flexDirection="column" width="45%" marginRight={2}>
          {filtering && (
            <Box>
              <Text>/ </Text>
              <TextInput
                value={filter}
                onChange={setFilter}
                onSubmit={value => {
                  setFiltering(false);
                  if (value.trim()) onActivity(`Searched for "${value.trim()}"`, currentTreePath());
                }}
              />
            </Box>
          )}
          {!filtering && filter && (
            <Text dimColor>
              Filter: "{filter}" ({rows.filter(r => r.kind === 'element').length} match
              {rows.filter(r => r.kind === 'element').length === 1 ? '' : 'es'}) · / edit · Esc clear
            </Text>
          )}
          {/* wrap="truncate-end": Ink doesn't reliably reserve vertical
              space for a wrapped Text node inside a tight flex column — a
              long label that wraps to 2 lines can get the next row drawn on
              top of its second line instead of below it. Every row here is
              deliberately a single flat Text (not a nested Box) for the
              same reason — a Box-per-row table layout is more visually
              aligned but it's exactly the shape that corrupted a different
              screen earlier this session once content got tall. */}
          {hiddenAbove > 0 && <Text dimColor>↑ {hiddenAbove} more above</Text>}
          {visibleSlice.map((row, i) => {
            const absoluteIndex = viewportStart + i;
            const isCur = absoluteIndex === cursor;
            const prefix = isCur ? '❯ ' : '  ';
            if (row.kind === 'group') {
              return (
                <Text key={row.key} color={isCur ? 'cyan' : undefined} wrap="truncate-end">
                  {prefix}
                  {row.expanded ? '▼' : '▶'} {row.name} ({row.count})
                </Text>
              );
            }
            if (row.kind === 'cluster') {
              return (
                <Text key={row.key} color={isCur ? 'cyan' : undefined} wrap="truncate-end">
                  {prefix}  {row.expandState > 0 ? '▾' : '▸'} {row.label} ({row.count})
                </Text>
              );
            }
            if (row.kind === 'more') {
              return (
                <Text key={row.key} color={isCur ? 'cyan' : undefined} dimColor wrap="truncate-end">
                  {prefix}  └─ ... {row.remaining} more
                </Text>
              );
            }
            const el = row.el;
            const glyph = confidenceGlyph(deriveConfidence(el));
            const name = el.accessibleName || el.id || el.name || `<${el.tag}>`;
            const typeLabel = el.tag + (el.type ? `:${el.type}` : '');
            const actionsLabel = el.availableActions.join('·') || 'none';
            return (
              <Text key={row.key} color={isCur ? 'cyan' : undefined} wrap="truncate-end">
                {prefix}
                {row.clusterKey ? '  ├─ ' : '  '}
                {glyph} {name}  {typeLabel}  {actionsLabel}
                {!el.id && isFormField(el) ? ' ⚠' : ''}
              </Text>
            );
          })}
          {hiddenBelow > 0 && <Text dimColor>↓ {hiddenBelow} more below</Text>}
        </Box>
        <Box flexDirection="column" width="55%" borderStyle="round" borderColor="gray" paddingX={1}>
          {inspecting && highlighted ? (
            <>
              <Text bold wrap="truncate-end">
                Inspect: {highlighted.accessibleName || '(no accessible name)'}
              </Text>
              <Text dimColor wrap="truncate-end">
                Ancestor trail: {highlighted.cssPath.split(' > ').slice(0, -1).join(' › ') || '(root)'}
              </Text>
              <Text wrap="truncate-end">All ranked selectors:</Text>
              {highlighted.selectors.map((s, i) => (
                <Text key={i} wrap="truncate-end">
                  {' '}
                  - {s.type} {s.value} ({s.confidence})
                </Text>
              ))}
              <Text wrap="truncate-end">
                Validation: required={highlighted.required ? 'yes' : 'no'} readonly={highlighted.readonly ? 'yes' : 'no'}{' '}
                disabled={highlighted.disabled ? 'yes' : 'no'} multiple={highlighted.multiple ? 'yes' : 'no'}
              </Text>
              <Text dimColor>Esc/i close inspect · q back</Text>
            </>
          ) : highlightedRow?.kind === 'group' ? (
            <>
              <Text bold wrap="truncate-end">
                {highlightedRow.name}
              </Text>
              <Text dimColor>
                {highlightedRow.count} elements — {highlightedRow.expanded ? 'Enter/← collapse' : 'Enter/→ expand'}
              </Text>
            </>
          ) : highlightedRow?.kind === 'cluster' ? (
            <>
              <Text bold wrap="truncate-end">
                {highlightedRow.label}
              </Text>
              <Text dimColor>
                {highlightedRow.count} elements in this collection — Enter/→ expand · ← collapse
              </Text>
            </>
          ) : highlightedRow?.kind === 'more' ? (
            <Text dimColor>Press Enter or → to show all {highlightedRow.remaining} more</Text>
          ) : highlighted ? (
            <>
              <Text bold wrap="truncate-end">
                {highlighted.accessibleName || '(no accessible name)'}
              </Text>
              <Text wrap="truncate-end">
                Tag: {'<' + highlighted.tag + (highlighted.type ? ` type="${highlighted.type}"` : '') + '>'}
              </Text>
              {highlighted.groupContext && <Text wrap="truncate-end">Group: {highlighted.groupContext}</Text>}
              <Text>
                Visible: {highlighted.visible ? 'yes' : 'no'}  Disabled: {highlighted.disabled ? 'yes' : 'no'}  Required:{' '}
                {highlighted.required ? 'yes' : 'no'}
              </Text>
              <Text wrap="truncate-end">
                Selector: {highlighted.bestSelector.type}={highlighted.bestSelector.value} (
                {highlighted.bestSelector.confidence} confidence)
              </Text>
              {!highlighted.id && isFormField(highlighted) && <Text color="yellow">⚠ No id present</Text>}
              <Text wrap="truncate-end">Available actions: {highlighted.availableActions.join(' · ') || 'none'}</Text>
              <Text wrap="truncate-end">Inspection: {confidenceGlyph(deriveConfidence(highlighted))} {confidenceLabel(deriveConfidence(highlighted))}</Text>
              {notes[elementKey(scan?.url ?? '', highlighted)] && (
                <Text wrap="truncate-end">Note: {notes[elementKey(scan?.url ?? '', highlighted)]}</Text>
              )}
              <Text dimColor>[Enter] Execute action    [I] Inspect details    [N] Add note</Text>
            </>
          ) : (
            <Text dimColor>No element selected</Text>
          )}
        </Box>
      </Box>
      {noting && (
        <Box paddingX={1}>
          <Text>Note: </Text>
          <TextInput
            value={noteDraft}
            onChange={setNoteDraft}
            onSubmit={() => {
              if (highlighted) {
                setNotes(prev => ({ ...prev, [elementKey(scan?.url ?? '', highlighted)]: noteDraft }));
              }
              setNoting(false);
            }}
          />
        </Box>
      )}
      {filling && highlighted && (
        <Box paddingX={1}>
          <Text>Fill value: </Text>
          <TextInput value={fillDraft} onChange={setFillDraft} onSubmit={value => submitFillLike(highlighted, value)} />
        </Box>
      )}
      {selecting && highlighted && highlighted.options && (
        <Box flexDirection="column" paddingX={1}>
          <Text>
            {highlighted.multiple ? 'Select one or more — Space toggle · Enter confirm: ' : 'Select a value — Enter confirm: '}
          </Text>
          {highlighted.options.map((opt, i) => (
            <Text key={opt.value} color={i === selectCursor ? 'cyan' : undefined} wrap="truncate-end">
              {i === selectCursor ? '❯ ' : '  '}
              {highlighted.multiple ? (multiSelectDraft.has(opt.value) ? '[x] ' : '[ ] ') : ''}
              {opt.label}
            </Text>
          ))}
        </Box>
      )}
      <Box paddingX={1}>
        <Text dimColor>
          {inspecting
            ? 'Esc/i close inspect · q back'
            : selecting
            ? `↑↓ choose${highlighted?.multiple ? ' · Space toggle' : ''} · Enter confirm · Esc cancel`
            : '/ Search · ↑↓ Navigate · ←→ Expand/collapse · Enter Select · i Inspect · n Note · r Rescan · s Save report · q Back'}
        </Text>
      </Box>
      <StatusBar text={saved ? `Saved to ${saved}` : status} spinning={status.endsWith('…')} tone={saved ? 'success' : 'info'} />
    </Box>
  );
}
