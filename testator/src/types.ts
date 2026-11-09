export type Confidence = 'high' | 'medium' | 'low';

export interface SelectorCandidate {
  type: 'data-testid' | 'id' | 'name' | 'label' | 'css' | 'xpath';
  value: string;
  confidence: Confidence;
  // Set when this exact (type, value) pair matches more than one element in
  // the scan — e.g. duplicate ids, or repeated button/link text in a list or
  // table (very common on real sites). Disambiguates via .nth(n) at use time.
  nth?: number;
}

export interface ElementRecord {
  index: number;
  tag: string;
  type: string | null;
  id: string | null;
  name: string | null;
  dataTestId: string | null;
  classes: string[];
  cssPath: string;
  xpath: string;
  visible: boolean;
  disabled: boolean;
  readonly: boolean;
  required: boolean;
  draggable: boolean;
  contentEditable: boolean;
  multiple: boolean;
  value: string | null;
  // Populated for <select> elements so testator can offer an actual picker
  // instead of asking you to type a value that has to match exactly.
  options?: { value: string; label: string }[];
  selectedValues?: string[];
  accessibleName: string | null;
  // Raw `role` attribute — used for semantic categorization (e.g. tabs/menu
  // items read as Navigation) when an element has no DOM-based groupContext.
  role: string | null;
  // Picked up via [tabindex]/[role=...] rather than a native interactive tag
  // (see scan.ts) — was already present at runtime but undeclared here.
  isCustomInteractive: boolean;
  groupContext: string | null;
  formId: string | null;
  selectors: SelectorCandidate[];
  bestSelector: SelectorCandidate;
  fingerprint: string;
  availableActions: string[];
  note?: string | null;
}

// An element whose attributes (not just its presence) differ between two
// scans of the same page — the element shown is the NEW version, `detail`
// describes what changed about it (e.g. "disabled false → true").
export interface ChangedElement {
  element: ElementRecord;
  detail: string;
}

// One step in the session's chronological exploration — either the very
// first scan of this screen, or one user-driven action and whatever it
// caused. This is the report's real data model: a navigation report is
// reconstructed by replaying these in order, never from a single final DOM
// snapshot. `added`/`removed`/`changed` are computed from comparing the
// scan taken right before this step against the one taken right after it
// settled — `added` additionally excludes anything already seen earlier
// in the session (on any page), so revisiting a known page doesn't
// re-announce its own elements as new discoveries. For a navigation step
// (previousUrl !== newUrl), `removed`/`changed` are intentionally empty —
// comparing two different pages' DOM field-by-field isn't a real diff, see
// engine/exploration.ts.
export interface ExplorationEvent {
  kind: 'initial-load' | 'action';
  timestamp: string;
  message: string;
  actingElement: ElementRecord | null;
  previousUrl: string | null;
  newUrl: string;
  navigated: boolean;
  added: ElementRecord[];
  removed: ElementRecord[];
  changed: ChangedElement[];
  // Running totals as of immediately after this step — what the
  // "Exploration overview" section's final numbers are built from. A
  // "screen" (Cases, Users, ...) is fixed for the whole report — it's a
  // testator-level concept, not a URL. Navigating within it (a list to one
  // of its own detail records) is a new PAGE, not a new screen, so this
  // counts distinct URLs visited, deliberately not called "screens".
  totalElementsSoFar: number;
  pagesVisitedSoFar: number;
}

// One element as it was seen on one specific page within this screen. A
// "screen" (Cases, Users, ...) can span several real sub-pages — a search
// list and one of its own detail records are the same screen, just
// different URLs within it — and each scan only ever covers whatever page
// is on screen *right now*. Accumulating one of these per element across
// every scan taken this session is what lets the saved report still show
// the search form's fields after you've navigated to a detail record and
// they're no longer part of the current scan at all.
export interface SeenElementEntry {
  url: string;
  element: ElementRecord;
}

export interface ScreenScan {
  workspace: string;
  screen: string;
  url: string;
  scannedAt: string;
  elements: ElementRecord[];
  suggestedFlows: string[];
}

export interface DiffChange {
  // 'navigated' is distinct from a real field-level diff: it means the two
  // scans being compared have different URLs — a list view vs. a detail
  // sub-page of the same screen, say — so an exhaustive added/removed list
  // would just be noise from comparing two different pages, not a real
  // regression signal. See diff.ts's diffScansSafe.
  type: 'added' | 'removed' | 'changed' | 'low-confidence-match' | 'navigated';
  message: string;
  // The element's display name (same fallback chain as diff.ts's describe())
  // — lets a rescan-results UI render a compact change list without having
  // to re-parse it out of `message`.
  label?: string;
}

export interface DiffResult {
  previousScanAt: string | null;
  changes: DiffChange[];
}

// Derived from a DiffResult for the rescan-results UI — `changed` combines
// 'changed' and 'low-confidence-match', matching report.ts's existing
// updateHistoryIndex convention. `unchanged` has no corresponding DiffChange
// entries (a fully-unchanged element produces none), so it's always a
// subtraction: newElementCount - added - changed.
export interface RescanSummary {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
}

export interface AuthConfig {
  username: string;
  password: string;
}

export interface SelectorsConfig {
  workspacePicker: string;
  screenPicker: string;
  contentRegion: string;
}

export interface Config {
  baseUrl: string;
  environment: string;
  browser: 'chromium' | 'firefox' | 'webkit';
  headless: boolean;
  auth: AuthConfig | null;
  reportsDir: string;
  historyDir: string;
  scenariosDir: string;
  logsDir: string;
  authStatePath: string;
  selectors: SelectorsConfig;
  ai: { enabled: boolean };
}

export interface LogEntry {
  timestamp: string;
  message: string;
}
