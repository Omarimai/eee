# testator

A terminal (Ink) tool for exploring a screen's DOM, recording what selectors/attributes each field has, saving a plain-text report for testers, tracking id/selector changes between scans, and recording/replaying click-and-type scenarios.

testator never has a UI of its own in the browser — it drives a real browser window (Playwright) on your behalf while you operate everything from the terminal.

## Setup

```
cd testator
npm install
```

`npm install` also downloads a Chromium build for Playwright (via `postinstall`). If that step fails or was skipped, run it manually:

```
npx playwright install chromium
```

## Configuration

Edit `config.json`:

- `baseUrl` — the page to test (already set to this repo's `lab/index.html`)
- `environment` — shown as a colored badge in the header (`development`/`staging` are muted, `production`/`release` show red — a reminder before you replay a scenario against something real)
- `headless` — `false` shows the real browser window next to your terminal; `true` hides it
- `auth` — credentials used to auto-log-in if a login form is found and no saved session exists
- `selectors.workspacePicker` / `selectors.screenPicker` / `selectors.contentRegion` — CSS selectors testator uses to discover workspaces/screens/the content area; defaults match the `lab/` app, edit these to point testator at a different app

## Running

```
npm start
```

A header bar is always visible at the top of every screen, showing: the environment badge, who's logged in (or not), and whether the browser is ready/connecting/errored — plus the most recent activity-log entry.

From the main menu:

- **Explore a screen** — scans the live DOM and shows every interactive element in one scrollable, collapsible list. **Every discovered element is automatically part of the report — there's no selection/checkbox step.** Moving the cursor only updates the detail panel; it never decides what gets saved.
  Elements are grouped by whatever real structure the page already has (a `.field-group-title`/accordion section's name); anything with no such structure falls back to one of 6 automatic categories (Navigation, Search & filters, Data & records, Actions, Forms, Other) inferred from tag/role/actions — a best-effort heuristic, not a guarantee. A run of 4+ near-identical rows/cards (e.g. 25 search results) collapses into one collapsible **collection** instead of 25 separate rows; expanding it shows a few, expanding again shows all of them, so nothing is ever truly hidden. Each element shows a confidence dot — `●` Complete, `◐` Partial, `○` Needs inspection — derived from its selector confidence, whether it has an accessible name, and whether a real action was found for it; `i` opens a deeper **Inspect** view (the full ranked selector list, an ancestor trail, validation flags) only for elements that need the extra look.
  `/` search (scans every group/category/collection regardless of collapse state, and force-reveals whatever matches) · `↑↓` navigate · `←→` expand/collapse the highlighted group or collection · **`Enter` is the one "do the thing" key** on an element: on a text/number/date field it prompts for a value and fills it, on a `<select>` it opens a real picker of the element's actual `<option>` values — `↑↓` to choose, `Space` to toggle a multi-select, `Enter` to confirm — instead of free-typing a value that has to match exactly; on a button/link/checkbox it clicks or toggles; on a custom widget picked up only via `tabindex`/`role` it keyboard-activates (focus + Enter), since a raw click often isn't wired up to do anything on those. It auto-rescans afterward, and after filling one field in a form it **auto-chains to the next fillable field** — reopening the right kind of prompt for whatever that field needs — so filling a whole form is `Enter → type/pick → Enter → type/pick…` with no manual navigation; the chain will auto-expand a collapsed *group* to reach the next field (groups are just a readability aid), but stops and explains itself if the next field is hidden inside a collapsed *collection* (those can be hundreds of rows — never materialized as a side effect of filling a form). `Esc` breaks the chain, cancels typing, closes Inspect, clears the filter, or backs out — one step at a time. `i` inspect · `n` add a note · `r` rescan (if anything actually changed since you last looked, this shows a **rescan results** overlay — `+added`/`-removed`/`~modified`/`=unchanged` counts plus a change list — rather than silently swapping the list; this only fires on a manual rescan, not after every auto-rescan) · `s` save a report · `q` back.
- **Record a scenario** — name it, then interact normally in the browser window; every click/change is logged. Press `s` in the terminal to stop and save.
- **Replay a scenario** — pick a saved scenario and testator replays it step by step.
- **View activity log** — the full session's log (also persisted to disk, see below).
- **View exploration tree** — a map of the session, not just a flat log: every workspace/screen you enter and every meaningful action you take gets positioned in a tree. Backing out and exploring something else adds a sibling branch rather than replacing anything, so the whole session stays visible, not just your current path.
- **Login / Logout** — if a saved session already exists (`.auth/state.json`), it's restored automatically and the login form is skipped entirely, since nothing new is being submitted. If there's no saved session, submitting the `auth` credentials from `config.json` into the real target app is treated as a consequential action, not a silent given: testator pauses on a **sign-in required** prompt naming the configured username and the target URL, and waits for an explicit `Enter`/`y` (sign in) or `Esc`/`n` (skip — the target app's own login screen stays up; you can sign in by hand in the browser instead). Declining never submits anything. **Logout** clears the saved session and logs you out of the live page, then shows the same consent prompt before offering to sign back in — it doesn't auto-resubmit credentials just because you were logged in a moment ago.

## Output

- `reports/<workspace>/<screen>/<timestamp>.txt` — human-readable report (and a `.json` twin used for diffing)
- `history/<workspace>/<screen>/index.json` — a running log of every scan (count of elements/changes), not a copy of the data
- `scenarios/<name>.json` (+ `.txt` twin) — recorded action sequences
- `logs/activity.log` — every login/logout/scan/save/replay event, timestamped, across all sessions
- `.auth/state.json` — the saved browser session (cookies + localStorage) used for login-once; **never commit this file**, it's gitignored by default since it's effectively a live credential

**The report is navigation-centric, not just an element dump.** It's reconstructed from a chronological event log — the scan taken right before each action paired with the one taken right after it settled — never from a single final DOM snapshot, so it can actually answer "what did this action cause" instead of just "what does the page look like now." Sections, in order:

- **Exploration overview** — starting URL, pages visited (a "screen" like Cases or Users is fixed for the whole report; opening one of its own detail records is a new *page* within it, never a new screen), total unique elements discovered, total interactions performed, total navigation transitions.
- **Navigation timeline** — the main content. One step per action (plus an initial "Step 1 — Initial screen loaded"), each showing: the element acted on (if any), whether the URL changed, and the real delta that resulted — new elements that appeared (grouped by UI section when there's real structure), elements that disappeared, elements whose attributes changed, or an explicit "No UI change detected" when nothing measurably did. A step that navigates to a new page shows that new page's full element set as what it discovered, never conflated with "N elements added to the old page."
- **Navigation graph** — an ASCII tree of the actual path taken (screen → action → what appeared/where it led → next screen's sections), not a hypothetical map of the whole app.
- **Complete element inventory** — secondary, reference-only: full id/selector/confidence detail for every element discovered on every page visited this session, grouped under a `=== Page: <url> ===` heading per page. A "screen" can span several real sub-pages (a search list and one of its own detail records are the same screen, just different URLs within it) — this is what keeps the search form's own fields in the report even after you've navigated to a detail record and they're no longer part of the current scan.
- **Changes since last scan** — unrelated to the timeline above: diffs this *save* against the most recently *saved* report for this screen (could be from a previous session). If the two scans being compared have different URLs, this section skips the field-by-field comparison (which would otherwise read as a wholesale added/removed flood) and just notes that a navigation happened — what actually happened is already in the timeline.

## Known v1 limitations

- Scenario recording logs raw `click`/`change` DOM events; it doesn't yet dedupe multi-fire sequences (e.g. a checkbox click also firing `change`).
- Suggested flows are only generated for `<form>` elements that have an `id` attribute.
- AI-assisted features (natural-language scenario authoring, semantic search, diff summaries) are deliberately not built yet — `config.json`'s `ai.enabled` flag is reserved for that, off by default.
