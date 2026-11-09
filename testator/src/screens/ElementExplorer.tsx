import { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { Page } from 'playwright';
import { StatusBar } from '../components/StatusBar';
import { scanScreen } from '../engine/scan';
import { saveReport } from '../engine/report';
import { tryElement, fillElement } from '../engine/interact';
import { diffScansSafe, summarizeRescan } from '../engine/diff';
import { elementKey } from '../engine/exploration';
import { buildRows, matchesFilter, locateElement, toggleExpandKey, setClusterLevel, type Row } from './elementExplorerRows';
import { useExplorationLog } from './useExplorationLog';
import { ElementRow } from './ElementRow';
import { ElementDetailPanel } from './ElementDetailPanel';
import { RescanOverlay } from './RescanOverlay';
import type { Config, ElementRecord, ScreenScan, DiffResult, RescanSummary } from '../types';

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

/**
 * The main exploration screen: scans the live DOM, renders it as one
 * scrollable collapsible list (see `elementExplorerRows.ts` for how), and
 * lets `Enter` fill/click/select/activate whatever's highlighted — live, in
 * the real browser. Every scanned element is unconditionally part of the
 * saved report; moving the cursor only changes what the detail panel shows.
 *
 * State here falls into three groups: UI mode flags (`filtering`/`noting`/
 * `filling`/`selecting`/`inspecting`/`acting` — which prompt or overlay, if
 * any, is currently capturing input), the current scan (`scan`, `cursor`,
 * `expanded`, `filter`), and this screen's own notes. The session's full
 * exploration history (every element ever seen, the chronological event
 * log the report's navigation timeline is built from) lives in
 * `useExplorationLog`, not here — nothing in this component's render tree
 * depends on it.
 */
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

  const { recordEvent, getAllSeenElements, getEvents } = useExplorationLog();

  const currentTreePath = () => [workspaceLabel, screen];

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

  useEffect(() => {
    (async () => {
      const result = await runScan();
      if (result) recordEvent('initial-load', 'Initial screen loaded', null, null, result);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows: Row[] = buildRows({ elements: scan?.elements || [], expanded, filter });

  useEffect(() => {
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
    const allSeenElements = getAllSeenElements().map(entry => ({
      url: entry.url,
      element: { ...entry.element, note: notes[elementKey(entry.url, entry.element)] || entry.element.note || null },
    }));
    setStatus('Writing report…');
    const { reportPath, diff } = saveReport(annotated, config, getEvents(), allSeenElements);
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
  const highlightedNote = highlighted ? notes[elementKey(scan?.url ?? '', highlighted)] : undefined;

  if (rescanOverlay) {
    return <RescanOverlay screen={screen} summary={rescanOverlay.summary} diff={rescanOverlay.diff} />;
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
          {hiddenAbove > 0 && <Text dimColor>↑ {hiddenAbove} more above</Text>}
          {visibleSlice.map((row, i) => (
            <ElementRow key={row.key} row={row} isCurrent={viewportStart + i === cursor} />
          ))}
          {hiddenBelow > 0 && <Text dimColor>↓ {hiddenBelow} more below</Text>}
        </Box>
        <Box flexDirection="column" width="55%" borderStyle="round" borderColor="gray" paddingX={1}>
          <ElementDetailPanel
            inspecting={inspecting}
            highlightedRow={highlightedRow}
            highlighted={highlighted}
            note={highlightedNote}
          />
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
