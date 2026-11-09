# testator

**A terminal copilot for QA testers.** Point it at a web app, drive it entirely from the keyboard, and it tells you — instantly, for anything on screen — what selector to use, whether it's safe to automate, and what changed since last time you looked.

You never leave the terminal. testator opens a real Chrome window next to it so you can see what's being tested, but you control everything — searching, filling forms, clicking, drilling into records — from the terminal. The browser is just the window you glance at to confirm you found the right thing.

---

## The two pieces

```
test-cli/
  lab/          a deliberately tricky demo web app — fraud-ops style
                dashboard with login, search forms, grouped records,
                every real-world edge case a tester actually hits

  testator/     the actual tool — an Ink (React-for-terminals) app
                that drives the lab (or any site) via Playwright
```

They're separate on purpose: `lab/` is the thing you'd test, `testator/` is the tool doing the testing. You could point `testator/` at any real site by changing one line in its config — the lab just happens to be stuffed with the exact problems a real site throws at you, built specifically to stress-test the tool against.

---

## The lab: a demo app built to bite

Three workspaces, each a believable mini fraud-ops dashboard:

| Workspace | Screens | What's deliberately broken on it |
|---|---|---|
| **Operations** | Fraud overview, Cases (search + detail), Todos | A clickable case list where the row only responds to double-click/keyboard, never a single click — a classic custom-widget trap |
| **Admin** | Users (search + detail) | A pair of fields that **share the exact same `id`** on purpose, fields hidden via `type="hidden"` vs CSS `display:none` vs visually-clipped-offscreen (three different kinds of "hidden," each meaning something different to an automated test), a checkbox whose `<label for>` deliberately points at the wrong id |
| **Parameters** | General settings | An accordion (`<details>`) where most sections start collapsed, two toggle switches whose label text lives in a sibling element rather than inside the control itself (so they have **no accessible name at all**), a drag-to-reorder list, a native `<dialog>` confirmation that only enables its Delete button once you type the word `DELETE` |

Every one of those is a real pattern that breaks naive automation. testator has to handle all of them correctly, or the lab tells on it immediately.

---

## The core loop

Boot up, sign in once (it's remembered next time), pick a workspace and a screen:

```
┌──────────────────────────────────────────────────────────────┐
│ [DEVELOPMENT]  ● admin  ● browser ready       Last: Ready     │
└──────────────────────────────────────────────────────────────┘

 testator — main menu

 ❯ Explore a screen
   Record a scenario
   Replay a scenario
   View activity log
   View exploration tree
   Logout
   Quit
```

The header never goes away: environment badge (gray in dev, red if this were ever pointed at production), who's logged in, whether the browser is still connected, and the most recent thing that happened — so you're never staring at a spinner with no idea what it's waiting on.

"Sign in once" isn't silent, though — submitting real credentials into the real target app is a consequential action, not something to do on your behalf without asking. The *first* time there's no saved session, testator pauses:

```
 Sign-in required

 testator wants to sign in as "admin" using the credentials in config.json, on:
 file:///.../lab/index.html

 Decline and testator won't submit anything — the target app's own login
 screen stays up; you can sign in by hand in the browser window instead.

 Enter/y sign in · Esc/n skip (browse without logging in)
```

Say yes and it signs in and remembers the session (`.auth/state.json`) so every future `npm start` skips this entirely — restoring an already-approved session isn't a new action, so that part stays silent. Say no and nothing gets submitted; the target app's own login screen just stays up. **Logout** clears the saved session and shows this exact same prompt before offering to sign back in — it doesn't auto-resubmit your credentials just because you were logged in a second ago.

**Explore a screen** scans the live DOM and lists every interactive element with its best selector, right there — grouped, with nothing to check off:

```
 operations › Cases › Explorer

 13 elements discovered · 2 groups · All elements automatically included

 ❯ ▼ Search & filters (5)                      ╭────────────────────────────────╮
     ● Case ref / merchant  input:text  fill…  │ Search                          │
     ● Status  select  selectOption            │ Tag: <button type="submit">     │
     ● Min risk score  input:number  fill·cl…  │ Visible: yes  Disabled: no      │
     ● Opened after  input:date  fill·clear·…  │ Selector: label=Search (medium) │
     ● Search  button:submit  click            │ Available actions: click        │
   ▼ Data & records (8)                        │ Inspection: ● Complete           │
     ▸ 8 items (8)                             │ [Enter] Execute  [I] Inspect     │
                                                │ [N] Add note                     │
                                                ╰────────────────────────────────╯
 / Search · ↑↓ Navigate · ←→ Expand/collapse · Enter Select · i Inspect · r Rescan
```

There's no `[x]`/`[ ]` checkbox anywhere, because there's no "select which elements to keep" step — **every discovered element is automatically part of the report**, whether there are 13 of them or 2,000. Moving the cursor only updates the detail panel on the right; it never decides what gets saved. `Enter` is the one key that *acts*: on a text field it prompts for a value and fills it, on a `<select>` it opens a real picker of that field's actual options instead of asking you to type one from memory, on a button it clicks it, on a toggle it flips it, live in the browser — then re-scans so new content (search results, a newly-opened record) shows up automatically. Fill one field in a form and it **auto-chains straight to the next fillable one**, reopening the right kind of prompt for whatever that field needs, so filling a whole form is `Enter → type/pick → Enter → type/pick → Enter…` with zero manual navigation between fields:

```
 Fill value: Pixel Forge▌

 Select a value — Enter confirm:
 ❯ Open
   Investigating
   Escalated
   Closed
```

---

## It ranks selectors like a human would

For every element, testator doesn't just grab *an* id — it builds the full list of ways you could target that element and ranks them by how safe each one actually is to automate against:

```
Best selector: id=#case-search-q (high)
All selectors:
  - id            #case-search-q              high
  - label         Case ref / merchant          medium
  - css           #case-search-q               low
  - xpath         //*[@id="case-search-q"]     low
```

`data-testid` beats `id` beats `name` beats accessible label beats a raw CSS path beats XPath — the same priority order real test-automation guidance recommends, because it's ordered by "how likely is this to survive the next redesign," not by what's easiest to grab.

**Duplicate ids don't break this.** The Admin lab screen has two different fields sharing `id="dup-field"` on purpose. testator catches that there are two matches and disambiguates them — `#dup-field` and `#dup-field#1` — so each one still resolves to the *specific* element that was actually scanned, not a coin flip.

---

## It groups by what the page actually is — not by how many fields it has

A page with real structure (a grouped case record, an accordion of settings) keeps its own section names as groups — `Case info`, `Transaction`, `Risk & flags` — read straight off the DOM, not invented. Anything with **no** real structure doesn't get dumped into one "ungrouped" pile either: it's sorted into one of six automatic categories (Navigation, Search & filters, Data & records, Actions, Forms, Other) inferred from tag/role/available actions. Groups and categories sit inline in one scrollable list — collapsed by default once they're large, expanded by default when they're small — instead of forcing a separate "pick a group" screen before you can see anything:

```
 ❯ ▼ Search & filters (5)
   ▶ Case info (6)
   ▶ Transaction (8)
   ▶ Risk & flags (10)
   ▶ Investigator notes (3)
```

`←`/`→` expand or collapse whatever's highlighted; `Enter` does the same. This is a heuristic, not a guarantee — the category rules key off labels containing words like "search"/"filter", so an oddly-named field can land in the more generic bucket (Forms instead of Search & filters, say) — but it beats one undifferentiated pile every time.

## It collapses repeated rows into one collection, not 25 separate lines

A search result list, a table body, a card grid — anything with 4 or more near-identical siblings (same parent shape, same tag, same classes) collapses into a single **collection** line instead of flooding the list:

```
   ▼ Data & records (8)
     ▸ 8 items (8)
```

`→` once expands it to a short preview (a few rows + "...N more"); `→` again shows every member. Nothing is ever permanently hidden — it's just not dumped on you by default. Native form controls (inputs, selects, checkboxes) are never clustered this way even if there happen to be several of them, since a repeated group of checkboxes is deliberate form structure, not a data collection.

## It tells you which elements it's actually sure about

Every element gets a confidence dot, derived from what the scanner already knows about it — no extra work required:

```
 ELEMENT                         INSPECTION
 Case reference                  ● Complete
 Status                          ● Complete
 Dynamic chart                   ◐ Partial
 Custom dropdown                 ○ Needs inspection
```

`●` Complete means a high-confidence selector, a real accessible name, and a recognized action — safe to automate against without a second look. `◐`/`○` mean one or more of those is missing or shaky. You only need to press `i` (Inspect) on the ones that actually need it — it opens the full ranked selector list, the element's ancestor trail, and its validation flags, instead of showing all of that for every single field all the time.

---

## The report reads like the session happened, not like a DOM dump

Early versions of this report were element-centric: a pile of discovered fields, plus a separate list of actions, with no link between them — you had to mentally reconstruct "what caused what." The report now is **navigation-centric**: it's reconstructed by replaying a chronological event log (the scan taken right before each action, paired with the one taken right after it settled), never from just the final DOM snapshot. Five sections, in order:

```
TESTATOR NAVIGATION REPORT
Screen: operations > Cases
Scanned: 2026-11-08T12:13:22.386Z

EXPLORATION OVERVIEW
  Starting URL: file:///.../lab/index.html#/op/fraud-cases
  Pages visited: 2
  Total unique elements discovered: 47
  Total interactions performed: 3
  Total navigation transitions: 1
```

Then the part that actually matters — the **navigation timeline**, one step per action, each showing the real delta that resulted:

```
NAVIGATION TIMELINE
------------------------------------------------------------

Step 1 — Initial screen loaded
  URL: file:///.../lab/index.html#/op/fraud-cases
  Elements discovered: 13
  Elements on this page:
    - Case ref / merchant
    - Status
    - Search
    - CASE-5001 · Nova Electronics USD 482.50 · opened 2025-10-21 risk 71 open
    ...
  Running total: 13 elements across 1 page (same screen)

Step 2 — Clicked "Search" in the browser
  Acting element: Search (label=Search, confidence: medium)
  URL: unchanged (file:///.../lab/index.html#/op/fraud-cases)
  UI change: No UI change detected.
  Running total: 13 elements across 1 page (same screen)

Step 3 — Activated "CASE-5001 · Nova Electronics..." via keyboard (focus + Enter) in the browser
  Acting element: CASE-5001 · Nova Electronics... (label=..., confidence: medium)
  Navigation: file:///.../#/op/fraud-cases → file:///.../#/op/fraud-cases/case-5001
  New page loaded (same screen).
  Elements discovered: 34
  New elements, grouped by section:
    Case info:
      - Case reference
      - Merchant
      ...
    Transaction:
      - transactionId
      ...
  Running total: 47 elements across 2 pages (same screen)
```

A "screen" (Cases, Users, ...) is fixed for the whole report — it's a testator-level concept, not a URL. Opening a case's detail record is a new *page* within the Cases screen, never a new screen; the overview and every running total say "pages," on purpose, so this never reads as if you'd left the screen you're actually still exploring.

Nothing is ever claimed that the captured scans don't actually establish — clicking Search here genuinely changed nothing (the results were already loaded), so the report says exactly that instead of guessing. Activating a row didn't just add fields to the same list — it's shown as a real navigation to a different page, with that page's own element set, never conflated with "34 elements added."

Then a **navigation graph**, reflecting the actual path taken (never a hypothetical map of the whole app):

```
NAVIGATION GRAPH
------------------------------------------------------------

operations > Cases
  ├── Clicked "Search" in the browser
  └── Activated "CASE-5001 · Nova Electronics..." via keyboard (focus + Enter) in the browser
      └── file:///.../lab/index.html#/op/fraud-cases/case-5001
          ├── Case info
          ├── Transaction
          ├── Risk & flags
          └── Investigator notes
```

And, kept accessible but deliberately secondary to all of the above, the **complete element inventory** — full id/selector/confidence detail for every element discovered on every page visited this session, grouped under a `=== Page: <url> ===` heading per page:

```
COMPLETE ELEMENT INVENTORY (reference)
------------------------------------------------------------

=== Page: file:///.../lab/index.html#/op/fraud-cases ===

[1] Case ref / merchant
  Tag: <input type="text">
  Best selector: id=#case-search-q (confidence: high)
  ...

=== Page: file:///.../lab/index.html#/op/fraud-cases/case-5001 ===

[14] Case reference
  ...
```

Open a search list, navigate into one of its records, save — the search form's own fields don't vanish from the report just because you're not looking at that page anymore. They're still right there, under their own page heading, in the order you actually visited them.

Finally, a **changes since last scan** section — unrelated to the timeline above, this one diffs this *save* against the most recently *saved* report for this screen (possibly from a previous session entirely):

```
CHANGES SINCE LAST SCAN (2026-11-06 23:20:28)
  ⚠ LOW CONFIDENCE: "Username" matched by label+position only.
    Previously had id="detail-username", now none. Verify manually.
  + ADDED: "Record created" is new.
```

If the two scans being compared have different URLs — a list vs. one of its own detail records, say — this section skips the field-by-field comparison (which would otherwise read as a wholesale `+ ADDED`/`- REMOVED` flood, every field on the old page "removed," every field on the new one "added," looking like data loss when nothing was lost) and just notes that a navigation happened: what actually happened is already in the timeline above it.

**Rescanning doesn't just quietly replace what you were looking at, either.** Press `r` and, if anything actually changed, you get a live summary before you even save anything:

```
 RESCAN RESULTS · Cases

 + 1 new element
 - 1 removed element
 ~ 1 modified element
 = 11 unchanged elements

 CHANGES
 + verify-extra-field is new.
 - case-search-date is no longer present.
 ~ "Case ref / merchant" — required false → true

 Esc/q close · s save report
```

This only fires on a *manual* rescan — the automatic rescan after every fill/click would make this unbearably noisy, so those stay silent unless you explicitly ask "did anything change?" (It's still recorded as its own step in the saved report's timeline, even though it doesn't pop the live overlay unless something changed.)

---

## It remembers the whole session, not just where you are now

```
 Exploration tree — this session

 ├─ Logged in as admin (session saved for next run)
 ├─ Operations
 │  └─ Cases
 │     ├─ Filled "Case ref / merchant" with "Pixel Forge"
 │     ├─ Clicked "Search" in the browser
 │     └─ Activated "CASE-5003 · Pixel Forge Games..."
 └─ Admin
    └─ Users
```

Back out of something and go explore a different screen — it doesn't vanish, it becomes a sibling branch. At the end of a session you have an actual map of everything you touched, not just a flat log of your current path.

## Record once, replay forever

Name a scenario, then just use the app normally in the browser window — every click and change gets captured live:

```
 Recording "login-and-check-case-5003" — interact in the browser now

 click id=#case-search-q
 input id=#case-search-q
 click [data-testid="user-risk-score"]

 s save & stop · Esc cancel
```

Later, pick it from a list and watch it play back step by step, with the status bar naming exactly which step is running — never a silent wait.

---

## What's on disk

Nothing lives only in memory — every scan, report, and recording survives the session:

```
testator/
  reports/<workspace>/<screen>/2026-11-07T14-02-11.txt   human report
  reports/<workspace>/<screen>/2026-11-07T14-02-11.json  same scan, machine-readable (powers the diff)
  history/<workspace>/<screen>/index.json                 running log: when you scanned, what changed
  scenarios/login-and-check-case-5003.json                 replayable step list
  logs/activity.log                                        every action, timestamped, across all sessions
  .auth/state.json                                         saved login session (gitignored — it's a live credential)
```

## Config, not code

Pointing testator at a different app is a config edit, not a rewrite:

```json
{
  "baseUrl": "file:///path/to/your/app.html",
  "environment": "development",
  "headless": false,
  "auth": { "username": "admin", "password": "admin" },
  "selectors": {
    "workspacePicker": ".workspace-tab",
    "screenPicker": ".sidebar-nav .nav-link",
    "contentRegion": "#route-content"
  }
}
```

`baseUrl` plus the `selectors` block are the only lab-specific parts — point `baseUrl` at your own app and swap those three CSS selectors for whatever its navigation looks like, and everything else (scanning, ranking, diffing, the whole UI) works unchanged.

---

## Keybindings, all of them

| Key | In the element list | On a group/collection header | While recording |
|---|---|---|---|
| `/` | search across every group/category/collection, regardless of collapse state | — | — |
| `↑↓` | move the cursor | move the cursor | — |
| `←→` | — | collapse / expand | — |
| `Enter` | fill/pick/click/activate the highlighted element, re-scan, chain to the next fillable field | expand/collapse (groups); step through collapsed→preview→full (collections) | — |
| `i` | open the Inspect panel (full selector list, ancestor trail, validation flags) | — | — |
| `n` | add a note | — | — |
| `r` | re-scan — shows a **rescan results** overlay if anything actually changed | re-scan | — |
| `s` | save report (the full scan, every element, always) | save report | save & stop recording |
| `Esc` | cancel typing → close Inspect → clear filter → back | back | cancel |
| `q` | back | back | — |

There is no flag/select/checkbox step anywhere in this table on purpose. The saved report already includes every discovered element regardless of where the cursor ever was — scanning and reporting are the scanner's job, not something you opt fields into one by one.

---

## Built the hard way

Not just written — stress-tested by actually driving the real interactive terminal UI with simulated keypresses across multiple live passes (plus real bugs caught from an actual `cmd.exe` session, with screenshots to prove it). That process found and fixed real bugs along the way:

- A React reconciliation bug where UI state silently leaked between completely different screens — the root cause behind more than one "I pressed the key and nothing happened" report.
- A race condition where the UI trusted the DOM again the instant a click *event* fired, before the app's own async work had actually finished — so a filtered search would come back looking unfiltered.
- Three separate dead-end screens where `Esc` stopped responding entirely after an action completed.
- A rendering bug where a long label's wrapped second line got the *next* row drawn on top of it — fixed by switching every list line to Ink's built-in single-line truncation instead of guessing safe character counts.
- A deeper version of that same overlap, caught while verifying the option picker: any screen with enough content to exceed the terminal's actual height (a 13+ element list, easily) would get a row silently dropped/overwritten, because the app pinned itself to a *fixed* full-screen height and let the layout engine shrink content to fit rather than scroll — fixed by pinning the *minimum* height instead, so a short screen still looks full-screen and a tall one now scrolls normally instead of corrupting.

## What's not built yet

Said out loud rather than hidden:

- Scenario recording doesn't dedupe multi-fire DOM events yet (a checkbox click also firing `change`).
- Semantic categorization and collection labels are honest best-effort, not guarantees: the 6-category fallback keys off keyword matching over labels/ids (so an oddly-named search field can land in a more generic bucket), and a collapsed collection's label is a generic `"N rows"`/`"N items"` rather than something like "Cases table" — there's no capture of the nearest heading/caption to name it better yet.
- The navigation graph nests a same-page action taken *after* a navigation (e.g. a manual rescan on a detail page) as a sibling of that page's discovered UI sections, rather than visually distinguishing "a section that exists" from "a thing you did next" — readable since they're phrased differently in practice, but not strictly disambiguated in the tree structure itself.
- An AI-assisted layer (natural-language scenario authoring, semantic search, plain-English diff summaries) is deliberately scoped out for now — `config.json` has a reserved `ai.enabled` flag, off by default, for exactly that later.

## Stack

Ink + React for the terminal UI, Playwright for the browser, TypeScript run directly via `tsx` — no build step.
