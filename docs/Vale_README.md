# Vale MVP
#united-mortgages/Vale 

A manually-triggered, human-gated batch email sender built on Google Sheets + Apps Script. This is the v1 sender plus the Addendum v1 build: stage prospects (or import them), review, send as real HTML mail, log. 

Cadence, reply reader, and scraper to be built in Phase 2.

## What this is

- Five sheets in one Google Sheet: `Prospects` (the contact log), `Send Queue` (the gated send surface), `Templates`, `Engine` (hidden config), `Run Log`.
- Every send goes through one function, `sendBatch_()`, called only from the menu in v1.
- Two modes, governed by a single `Engine!MODE` cell: `TEST` (sends real mail to a test address you control) and `LIVE` (sends to real prospects). Nothing silently escalates from one to the other.
- `TEST` is a genuine send, not a dry-run stub — it proves template rendering, thread capture, and writeback all actually work, using the real Gmail send path.
- Mail goes out as real HTML, not plain text. The BDM writes plain-text template copy with line breaks and never touches a tag — it's auto-converted. `Engine!SIGNATURE_BLOCK` can hold real pasted HTML (styling, links, a regulatory footer) and is sent through untouched.

## Files

As of the multi-BDM rollout the code lives in **two** Apps Script projects: one
shared library, and one thin container script per BDM's spreadsheet. The table
below reflects that split. (Filenames in the repo use spaces and `.js`; the
`.gs` names here are how they appear in the Apps Script editor.)

### The library — one project, shared by every BDM

| File | Responsibility |
|---|---|
| `appsscript.json` | Manifest — scopes, timezone, runtime |
| `00_Schema.gs` | Sheet/column names, the `STATUS` enum, placeholder map. **Nothing else in either project may hardcode a column letter or index.** |
| `01_Engine.gs` | Reads `Engine` fresh every run; imposes the operator-locked values; template lookup |
| `02_Setup.gs` | Builds the workbook. Takes seed data as an argument — seed data is BDM-owned and lives in the container |
| `04_Menu.gs` | Menu construction, dialog helpers, Setup Check |
| `05_Staging.gs` | Moves selected `Prospects` rows into `Send Queue`; core is shared with the sidebar |
| `06_Render.gs` | Fills `{{Placeholders}}`; refuses to send a blank |
| `07_Validation.gs` | Eligibility checks shared by Validate, Send, and the sidebar |
| `08_Send.gs` | The single send choke point, confirmations, lock, time budget, the test-mode operator CC |
| `09_Writeback.gs` | Writes results back to `Prospects`, keyed on Prospect ID; appends `Run Log` |
| `10_Sidebar.gs` | Implementations behind the Send Panel |
| `11_ImportCore.gs` | The import engine. Driven by a per-BDM profile; the validation rules are shared and not configurable |
| `13_Api.gs` | The public surface — the only names a container can call |
| `Sidebar.html` | The Send Panel itself — stage dropdown, live status, inline Stage/Validate results |
| `SendPreview.html` | Modal dialog showing the first message as real rendered HTML — the send confirmation, triggered by both the menu and the panel |

There is no `03` in the library. That gap is deliberate: `03` was the seed data,
and seed data is the BDM's, not the fleet's.

### A BDM's container — three files, no logic

| File | Responsibility |
|---|---|
| `appsscript.json` | Manifest, including the pinned library version |
| `00_Config.gs` | This BDM's import profile — the source column map, and any exclusion rule |
| `01_SeedData.gs` | This BDM's dummy prospects and draft templates |
| `02_Container.gs` | Thirteen one-line wrappers, and nothing else |

**Why the container needs any code at all.** Apps Script resolves menu-item
function names and `google.script.run` targets in the *spreadsheet-bound*
script's global scope, never in a library, and it does not export functions
whose names end in an underscore. So each container carries thirteen wrappers
that do nothing but delegate to `Vale.*`. That is the irreducible floor of the
thin-container pattern on this platform, not a design choice — and it is why
the library has a `13_Api.gs` naming its public entry points rather than
exposing its internals wholesale.

**Anything added to a container is added for one BDM only.** Behaviour belongs
in the library; a container holds data.

## Install

Two projects now, in this order. The library must exist and be published
before any BDM's sheet can reference it.

### 1. The library (once for the whole fleet)

1. Open the library's Apps Script project.
2. Create each library `.gs` file above by name (keep the numeric prefixes — load order matters) and paste its contents. For `Sidebar.html` and `SendPreview.html`, use the editor's **+ ▸ HTML** option and name each file to match (no extension needed in the editor — `Sidebar` and `SendPreview`).
3. Project Settings ▸ check *Show "appsscript.json" manifest file in editor* ▸ open it ▸ replace with the library's `appsscript.json`.
4. **Set `OPERATOR_CC` at the top of `08_Send.gs`** to the address that should be copied on test sends. It ships blank, which disables the CC. A wrong address here is worse than none — it silently copies a stranger on every test send.
5. Deploy ▸ **New deployment** ▸ *Library*, and note the version number. Every container pins a version explicitly; nothing auto-upgrades.

### 2. A BDM's spreadsheet (once per BDM)

1. Create a **blank** Google Sheet.
2. Extensions ▸ Apps Script.
3. Delete the default `Code.gs`. Create `00_Config.gs`, `01_SeedData.gs` and `02_Container.gs` and paste that BDM's contents.
4. Project Settings ▸ show the manifest ▸ replace with that BDM's `appsscript.json`. Check that the `libraries` entry names the right **version** — this is the pin, and it is the whole versioning discipline.
5. Run `setupWorkbook()` from the editor (select it in the function dropdown ▸ Run). Approve the permissions prompt.
6. Back in the Sheet: View ▸ Show hidden sheets ▸ `Engine`. Replace the three placeholder values:
   - `TEST_EMAIL` — a real address you control
   - `SENDER_NAME`
   - `SIGNATURE_BLOCK` — must include a working opt-out line. Plain text or real HTML both work; paste the actual company signature here, tags and all, if you have one.
7. Reload the Sheet. The **Outreach** menu appears, with **Open Send Panel** at the top.

Sending is refused while any of the three above still holds its shipped placeholder text — this is checked by content, not just by blank-ness, so a forgotten default can't slip through as "configured."

`MAX_SENDS_PER_RUN` and `MIN_DAYS_BETWEEN_EMAILS` also appear on `Engine`, greyed by convention rather than by a protected range. **Editing them has no effect** — see the Engine lock below. *Setup Check* reports any edit as ignored, so a change that does nothing still says so out loud.

### Verifying a change before it reaches a BDM

`node harness/run.js` runs the off-Sheet harness — 188 assertions, no `npm install`. It loads the library into a Node VM with the Sheets and Gmail APIs stubbed, and reads `docs/Muki_Template_SAMPLE.xlsx` directly on every run rather than trusting a transcribed fixture. It does **not** go into the Apps Script editor.

The operator's own test sheet is the other half: its manifest sets `developmentMode: true`, so it tracks library **head** and picks up a saved change with no version bump. Try a change there first, then publish a version, then bump the pin in a BDM's manifest.

## Distribution

Drive ▸ *Make a copy*. Each user owns their own file outright; there's no shared backend. `Engine` is hidden but **not a secrets store** — a hidden sheet is one click away for a file's own owner. It only ever holds operational config (mode, cap, sender name, signature). If Phase 2 introduces a real credential (e.g. a Gemini API key), it belongs in Apps Script's `PropertiesService`, never in a sheet cell.

## Day-to-day use

**Outreach ▸ Open Send Panel** is the primary way to run a batch — everything below happens inline in one panel, no menu-hunting or text prompts.

0. **First time only, or whenever the source list has new people on it:** paste the source list into its own tab (keeping its header row), then **Outreach ▸ Import from …**. The menu item names your own list — *David's List* on David's sheet, *Muki Template* on Muki's — and you'll be asked for the tab name, which defaults to the usual one. Reports what was imported and what wasn't, with a reason for every skip (missing field, malformed email, already on Prospects). Safe to re-run: anyone already imported is recognised by email and skipped, never duplicated.

   The importer **refuses before writing anything** if the tab's header row doesn't carry every column it needs, naming what's missing and listing what the tab actually has. It will not substitute a close-enough column name — a near-miss imports silently and wrongly, and only surfaces later as wrong merge values inside real emails.

   On Muki's sheet, rows carrying prior outreach import **paused** rather than active — see *Design decisions* below.
1. Select the rows you want on `Prospects` (click a row number, or drag across several).
2. In the panel: pick a stage from the dropdown, click **Stage selected Prospects rows**. You'll see staged/not-staged counts immediately — and, in the same result, anything that staged but would currently **fail at send time** (malformed email, missing name, duplicate within the batch), so you're not surprised later. If none of this appears, don't skip it — see it as your first check.
3. On the `Send Queue` tab, set **`Send?` = Y** on the rows you actually want to go out. Nothing is pre-checked, from either surface.
4. Back in the panel: **Validate Send Queue** for a final read-only check, then **Send Batch**. In `LIVE` mode you'll first get a native dialog naming the exact recipient count. Either way, a preview window then opens showing the first message exactly as it will arrive — real rendered HTML, signature and all, not raw tags. Nothing sends until you confirm inside that window; the run's result (sent / skipped / failed) appears there too, so leave it open until it says it's finished.
5. **Setup Check** remains menu-only for now — occasional housekeeping, not part of the regular send flow.

The classic **Outreach** menu items (`Add Prospects to Send Queue`, `Validate Send Queue`, `Send Batch`, `Import from David's List`) still work exactly as before and call the identical underlying logic as the panel — same functions, same checks, same confirmations. Neither surface can drift from the other; there's one send path, one staging path, one import path, one validation path, and both UIs are thin wrappers around them.

## Design decisions worth knowing about

**TEST-SENT never blocks a real send.** A row can be TEST-SENT and still be fully eligible for LIVE — that's deliberate, so a test batch never accidentally locks out the real one that follows. Only `SENT` and `FAILED` gate a stage.

**Thread ID and Last Contacted are LIVE-only writes to `Prospects`.** They're captured on the `Send Queue` row in both modes (so a TEST run still proves the pipeline end-to-end), but only a real send updates the prospect's own record. A test thread is a conversation with your test inbox, not the prospect — writing it to `Prospects` would risk it later being mistaken for a real reply thread. See the Dev Log for the full reasoning; this is a deliberate departure from a literal reading of the original spec, made to protect Phase 2's reply-detection logic before it exists.

**A missing placeholder value is a hard failure, never a blank.** The renderer will not produce `Hi ,` under any circumstance — a row missing a value the active template needs is skipped with a named reason, not sent short.

**Staging tells you immediately if what just staged will fail to send.** Malformed email, a missing merge-field value, or a duplicate within the same batch are checked the moment you stage, not just later at Validate or Send — you no longer have to run a second command to find out a row you just staged is actually dead on arrival.

**The message preview is a window, not a panel message — because it has to be able to render real HTML.** `SIGNATURE_BLOCK` can now hold real HTML the company controls, including regulatory footer content, and a native `Ui.alert()` can't render that — it would show raw tags, which defeats the point of showing it at all. So the first-message preview opens as its own window (`SendPreview.html`) with the message rendered as it will actually arrive, and that window is also where you confirm the send. It's still a hard interruption over the sheet, not an inline panel update — the same reasoning that originally kept confirmations out of the panel, just carried by a different kind of window. **In `LIVE` mode the recipient-count check still runs first, as its own native dialog** — unchanged in content, just re-ordered ahead of the preview window, because two interrupting dialogs can't reliably stack.

**The plan is re-checked at the moment you confirm, not assumed from when you opened the preview.** There's a gap between opening the preview and clicking Send where the queue could change underneath it. Confirming inside the window re-reads Send Queue and Prospects from scratch and compares against a fingerprint of exactly which rows and addresses were shown; if anything shifted in that gap, the send is refused by name rather than sending something other than what was previewed.

**Body copy stays plain text; only the signature is trusted HTML.** The BDM writes templates with line breaks and never touches a tag — blank lines become paragraphs, single line breaks become `<br>`, and anything that looks like a tag is escaped into visible text rather than executed. `SIGNATURE_BLOCK` is the one place real HTML belongs, pasted in by whoever owns the company signature, and it passes through untouched.

**An unlinked (hand-pasted) queue row is still checked against `Do Not Contact`.** Matched by email against `Prospects` even with no Prospect ID, so pasting a row in manually is never a way around the block.

**Muki's importer routes rows with prior outreach to `Paused`, it does not skip them.** Her source list carries its own hand-kept outreach columns — `Emailed`, `1st Called`, `Visit`, `Meeting`, `Offered`, `Signed as partner`. Any row with a value in *any* of them imports with `Paused = Y` and the raw text of those columns copied verbatim into `Notes`. Rows with no history import active and can be staged immediately.

Paused rather than skipped, because the person is a real prospect and belongs on the list — what is unsafe is *automated* outreach to someone a human has already contacted under rules this tool never applied. `Paused` is re-read from `Prospects` at send time, so such a row cannot be emailed even if it is staged by accident; un-pausing is a human clearing one cell after reading the `Notes`. The history is deliberately **not** written into `Email {n} Status`: that column means "this tool sent this stage", and a hand-logged "Aug 22" in a tracking sheet is not that. Writing it there would make the stage gate believe outreach had happened under guarantees it never had.

David's list has no equivalent columns, so his import has no such rule and every row he imports is active.

**Muki's `Town/Area` is not filled by her importer.** The mapping her build was specified against listed an `Address` column; her actual template has no such column, and the three plausible near-misses are all either unstable, mislabelled, or empty. Rather than guess — a wrong guess here does not fail loudly, it ships a plausible-looking wrong town inside real emails — the field is left unmapped and her seed templates omit `{{TownArea}}`. Resolving it later is one line in her `00_Config.gs`.

**The importer matches on email only, not email + name.** Email is already the identity the rest of the system runs on — the `Do Not Contact` check above depends on it. Matching on name too would let one address end up on two `Prospects` rows, and a block on one would be invisible to the other. The cost lands on shared mailboxes: two different people both reachable at `office@company.com` only get the first one imported — reported by name and source row, not silent, so the second can be added by hand.

## What this is not (Phase 2 territory)

Time-driven triggers, reply detection / Gmail searching, cadence gap logic, auto-progression through stages, the roundup email, AI reply classification, attachments, tracking pixels. All of `Prospects`' Phase 2 columns already exist, empty, untouched by this code — Phase 2 should need no schema migration if it's built to the Phase 2 prompt.


## Multi-BDM architecture

The body of this document originally described the single-sheet MVP built for
David. That migration is **done** — what is described above is now the
multi-BDM shape, not a plan.

- **Structure:** one spreadsheet per BDM. Shared logic (schema, engine, setup, staging, render, validation, send, writeback, menu and sidebar wiring, and the import engine) lives in a single bound, published, versioned Apps Script library. Each BDM's spreadsheet runs a thin container of three files and no logic.
- **Stays local per BDM:** `Prospects`, `Send Queue`, `Templates`, seed data, the import profile (source column map + any exclusion rule), and the per-BDM rows of `Engine` (`SENDER_NAME`, `TEST_EMAIL`, `SIGNATURE_BLOCK`, `MODE`, `REPLY_TO`).
- **`Engine` lock:** the sheet is not split. `MAX_SENDS_PER_RUN` and `MIN_DAYS_BETWEEN_EMAILS` are library constants, imposed over whatever the cell says every time `Engine` is read — the same allowlist pattern as `PROSPECT_WRITABLE`, applied to config. Enforcement is by override rather than refusal, because Apps Script cannot intercept a human typing into a cell; a refusal could only ever be a complaint raised later, at send time. Ignored edits are reported by *Setup Check* and in the Send Panel. `MIN_DAYS_BETWEEN_EMAILS` is locked but **not consumed by v1** — there is no cadence logic here yet. It is declared now so the key is operator-owned from day one rather than taken away from a BDM later.
- **Test-mode CC:** test sends copy the operator's address, set once in the library as `OPERATOR_CC`. Live sends are untouched — on a live send the `cc` key is never set on the Gmail options object at all. It is not an `Engine` row on purpose: an `Engine` row is a cell a BDM can clear.
- **Versioning:** pinned per BDM, never automatic. Each container's manifest names an explicit library version, bumped deliberately once a change is confirmed good. The operator's own test sheet is the exception and tracks head.
- **Current fleet:** David (live, running against the library), **Muki (live, running against the library)**, Mike (onboarding paused indefinitely — he has confirmed no short-term use case). The operator's test sheet is the fourth and never sends real outreach.

Muki's sheet is built, verified off-Sheet against `docs/Muki_Template_SAMPLE.xlsx`, and seeded so it is testable in `TEST` mode the moment it is installed. It has not yet had a real `TEST`-mode send, and her actual working list has **not** been imported — that is a decision she makes once she has the tool in front of her, not a build step.

**Still open.** Cell and header protection (protected ranges, pre-run header
validation) is deliberately parked, not designed. `Do Not Contact` matching
stays exact-string, not dot- or plus-aware — consistent with duplicate
detection rather than fixed on one side only. And because Mike's track is
paused, the assumption that agent prospecting and client outreach share a
schema is still formally unverified; it costs nothing while he is not using
the tool.

Full context: [[Vale_Extension_Handover]]


---

# Appendix

## Emoji List


> [!bug] Emoji Encoding
> Gmail's plain-text send path (which the MVP currently uses via `GmailApp.sendEmail()`) doesn't preserve Unicode properly for all emoji ranges. Some emoji encode fine; others either don't have stable support across email clients or require UTF-8 handling that plain-text sends botch.

- 🚩
- 📅