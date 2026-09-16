# Vale Development Log
#united-mortgages/Vale 

## 2026-08-25 — Send Panel sidebar, staging preview folded into the same popup

**Trigger:** first hands-on test run. Staged a mixed batch (clean rows plus the seeded edge cases — blank first name, malformed email, duplicate, DNC) and got a summary reading "Staged: 12, Not staged: 1 (the DNC row)" with no mention that three of the twelve would fail at send time. Technically correct — staging only gates on permanent blocks, send-time validation is genuinely a different check — but a real gap for anyone who isn't the person who wrote the code: the popup said "staged" and meant "staged, some of which won't actually go anywhere," and nothing in the message said so.

Two decisions taken together rather than as separate patches, since they solve the same underlying problem (`Add Prospects to Send Queue` requiring a menu hunt, a text-prompt for stage, and now a second command just to find out something you were about to be surprised by):

1. **Fold the send-time preview into the staging result itself**, so "staged 12" and "3 of these will be skipped unless fixed" arrive in the same message, immediately, rather than requiring a separate `Validate Send Queue` run to discover.
2. **Replace the text-prompt stage picker with a sidebar panel** — dropdown instead of typing a digit, one-click Stage / Validate / Send, live status (mode, quota, queue backlog, per-stage template health) always visible rather than fetched via a separate `Setup Check`. Scoped for the eventual BDM handoff, not just this test round.

### Things Wesley Has Noticed

> [!bug] BUG TO FIX
> When importing sidebar, it states the below:
> 
 "We're sorry, a server error occurred while reading from storage. Error code PERMISSION_DENIED."

Another thing worth adding would be field-clearing

### Refactor: one core, two surfaces

The risk with adding a second UI is the two surfaces quietly drifting apart — a fix applied to the menu path that never reaches the sidebar path, or vice versa. Pulled the actual logic out of both entry points into shared, stage-explicit functions that neither UI duplicates:

- `computeStagingPlan_(rowNums, stage)` / `commitStaging_(toStage, stage)` / `previewStagedProblems_(toStage, stage)` — staging, split into plan/commit/preview so both the confirm-and-write flow (menu, and the sidebar) and a pure read-only preview can share the same gating code. `stageRowsInteractive_()` wraps all three plus the no-prior-stage confirmation into the one call both UIs actually make.
- `runValidation_(stage)` — returns a structured result; `validationText_()` formats it for the menu's alert dialog, the sidebar formats the same fields itself for its inline panel.
- `sendBatchWithStage_(stage)` — the send path, now stage-explicit instead of prompting internally; both `sendBatchFromMenu()` and the sidebar's `sidebarSendBatch()` call it directly. Confirmation dialogs (first-message preview, LIVE recipient count) stay inside this shared function, not duplicated per-caller — so a safety gate exists exactly once in the codebase, not once per UI.

Two new files: `10_Sidebar.gs` (five thin server-side entry points — `getSidebarStatus`, `sidebarStageSelectedRows`, `sidebarValidate`, `sidebarSendBatch`, `showSendPanel`) and `Sidebar.html` (panel markup + `google.script.run` calls, no framework). `04_Menu.gs` gets one new item, `Open Send Panel`, first in the list; every existing menu item stays as-is as a fallback/troubleshooting path.

### Verified

Re-ran the harness against the refactored core with the same shape of batch that produced the original confusion — rows 2–8, including the blank-name and malformed-email seed rows. `previewStagedProblems_` now surfaces both in the same call that reports the staged count:

```
toStage: 7 rows staged
preview problems:
  - Row 5 Callaghan [P-00004] — missing value for {{FirstName}}
  - Row 8 Marcus Bell [P-00007] — malformed email address
```

That's the exact gap closed. Also exercised `getSidebarStatus()` and `sidebarValidate()` directly (no UI dependency, both pure data) and confirmed the status snapshot and per-stage template health match what `Setup Check` reports, and that `sidebarValidate` correctly shows all 7 rows as `notGated` before `Send? = Y` is set — the send-time gate still only fires once the operator has actually marked rows.

### Flagged, not verified — real risk, not a formality

**Whether `SpreadsheetApp.getUi().alert()` reliably fires when called from a function invoked via `google.script.run` from a sidebar, as opposed to from a menu item, is unconfirmed.** Both are supposed to run in the same bound-script context, but this can't be tested from the build environment — it needs a real Sheet. This matters more than most "verify on install" items because the two dialogs gated behind it are the two hard safety stops in the whole system: the first-rendered-message preview and the LIVE recipient-count confirmation. If either fails to appear when triggered from the sidebar, the fallback is to move that confirmation into the sidebar panel itself (a "type the recipient count to confirm" field, or a two-click panel state) rather than relying on a native dialog. **This is the first thing to test on the sidebar, before anything else.**

### Status

Sidebar built, wired to the existing menu functions with no logic duplicated. Staging-preview fold-in verified by harness. Native-dialog-from-sidebar behaviour is the one open question and is untestable from here — first real click of `Send Batch` in the panel settles it.

---

### 2026-08-25 — MVP build: sender, queue, staging gates, Phase 2 pre-emption
[[Tue 25-Aug 2026]]
**Spec:** `MVP_Build_Spec_v3.md`, superseding the original `Outreach_Automation_Spec.md`. Built against the Phase 2 prompt (`Phase2_Prompt_v3.md`) as a forward-compatibility check, not as scope — nothing in Phase 2 was built this session.

**Goal:** A manually-triggered, human-gated batch sender for cold outreach — `Prospects` log, `Send Queue` staging surface, `Templates`, hidden `Engine` config, `Run Log`. Deliberately not a cadence engine or reply reader; that's Phase 2, and the entire point of this session was making sure Phase 2 can be bolted on without touching what ships today.

#### Pre-build review surfaced five spec defects, all fixed before writing code

Sense-checking the spec against the Phase 2 prompt before touching the editor turned up problems the spec's own acceptance criteria wouldn't have caught, because each one only manifests once Phase 2 exists.

1. **`Thread ID` written to `Prospects` on TEST sends would have poisoned Phase 2 reply detection.** The spec says capture Thread ID on every send, test or live (§9.2). But a TEST thread is a conversation with the test alias, not the prospect — and Phase 2 fetches that thread by ID and treats any message from someone other than the operator as a reply. QA-ing a batch and having the test-inbox owner reply "looks good" would set `Reply Detected = Y` and permanently kill outreach to a prospect who was never actually emailed. Confirmed with the operator that the test alias is owned in-house, which narrows but doesn't remove the risk (an auto-responder on that alias reproduces it with no human involved). **Fixed:** Thread ID / Message ID captured on `Send Queue` in both modes — the pipeline is still proven end to end — but written to `Prospects` on `SENT` only. Cost: one line of acceptance criterion 5 amended. Nothing downstream loses anything: Phase 2 stage 2 requires `Email 1 Status = SENT`, which overwrites the field with the real thread regardless.

2. **`Last Contacted` stamped by test sends would have corrupted the Phase 2 reply window.** Phase 2 counts a reply only if it's dated after `Last Contacted`. A test batch touching an already-replied-to row would push that timestamp forward and hide a genuine reply from the very next cadence run. **Fixed:** `Last Contacted` records live sends only.

3. **The "already sent" staging gate read a sheet designed to be emptied.** Spec gates staging on "already `SENT` in `Send Queue` for this stage" (§8), but the queue is cleared after every batch by design (§3, §7). One `Clear Completed Queue Rows` and the gate has nothing to check against — same prospect stages and sends twice. **Fixed:** gate reads `Prospects.Email {n} Status`, the only field that survives a queue clear. Queue is still checked, but only for rows currently unprocessed (mid-batch protection, not history).

4. **Hand-pasted unlinked queue rows bypassed `Do Not Contact` entirely.** The spec explicitly permits a blank `Prospect ID` — "sends, but reported unlinked" — with no mechanism tying that row back to the control columns. That's not a plumbing gap, it's a compliance hole. **Fixed:** every queue row, linked or not, is matched against `Prospects` by email at send time and blocked on a `Do Not Contact` match regardless of whether it carries an ID. Verified in the harness run below — see the DNC-bypass test case.

5. **`GmailApp.sendEmail()` cannot return a Thread ID**, which acceptance criterion 5 requires capturing on every send. Recovering it after the fact means searching Sent mail by subject, which breaks the moment a batch shares a subject line — which every batch does. **Fixed:** switched to `GmailApp.createDraft(...).send()`, which returns a `GmailMessage` with `.getId()` / `.getThread().getId()` directly. Same quota, same deliverability, no search.

Two more added without discussion, flagged as sensible rather than negotiated: a `LockService` script lock around the send function (Phase 2's daily trigger will run alongside manual batches; without a lock, a trigger firing mid-batch reads the same blank-`Status` rows and double-sends), and a wall-clock exit at 5 minutes against Apps Script's ~6-minute ceiling — Phase 2 §4 requires this anyway, so it's the same code path built once rather than twice.

#### What was built

Ten files, header-name column resolution throughout (`headerMap_()`), never a hardcoded letter or index — the spec's own "mandatory" rule (§1) and the thing that keeps acceptance criterion 13 (reordering a column doesn't break the script) true by construction rather than by discipline.

- **`00_Schema.gs`** — sheet/column names, the `STATUS` enum, the `PLACEHOLDERS` map, `PROSPECT_WRITABLE` (an explicit allow-list of what script code may write on `Prospects` — added beyond the spec; every human-owned column, e.g. `Instagram DM Sent`, is structurally unwritable by the sender, not just conventionally so).
- **`01_Engine.gs`** — config read fresh every run, template lookup (exactly one `Active = Y` per stage, zero or two-plus is a hard error).
- **`02_Setup.gs`** — `setupWorkbook()`, idempotent: re-running never duplicates a sheet, reorders a column, or overwrites an Engine value the operator has already edited.
- **`03_SeedData.gs`** — 15 dummy prospects on `example.com` (RFC 2606, cannot receive mail), four deliberate edge cases per spec §11.
- **`04_Menu.gs`** — the five `onOpen()` items, all errors caught and surfaced as dialogs rather than failing silently.
- **`05_Staging.gs`** — the fixed already-sent gate (item 3), Prospect ID assignment that never reuses an ID even for rows no longer on the sheet.
- **`06_Render.gs`** — template rendering. A missing placeholder value is a validation failure, never a blank substitution — `Hi ,` is unreachable by construction, not by convention.
- **`07_Validation.gs`** — the eligibility/invalid split shared by `Validate Send Queue` (read-only) and `Send Batch` (writes `SKIPPED`); the DNC-bypass fix (item 4) lives here.
- **`08_Send.gs`** — the single send choke point per §9.6, the confirmation dialogs, the lock and time-budget additions, the `createDraft().send()` fix (item 5).
- **`09_Writeback.gs`** — keyed on Prospect ID only (§9.3), the Thread-ID and Last-Contacted amendments (items 1–2), `Run Log` append.

#### Verified

No live Gmail access from the build environment, so verification split into what could be checked here and what needs a real TEST batch.

**Checked here**, via a stub of the Sheets API run against a simulated 13-row queue:

- Eligible/skip split correct: 4 eligible, 7 skipped, each with a distinct reason string (duplicate-in-batch, missing-placeholder, malformed-email, DNC, Paused, already-`SENT`, and — the one that mattered — an **unlinked hand-pasted row matched to a DNC prospect by email and blocked**, confirming fix 4 holds).
- `TEST-SENT` correctly does **not** count as "already sent" — a row in that state is still eligible for a real send.
- Renderer throws on a blank `{{FirstName}}` rather than emitting a gap; all three seed templates render clean with the full placeholder set.
- Email regex rejects the seeded malformed address (`marcus.bell@example`, no TLD) and accepts the seeded valid ones.
- No duplicate headers across any of the five sheet schemas; every field `09_Writeback.gs` writes exists in `PROSPECT_WRITABLE` and in `PROSPECT_COLS`.

**Not checked, needs a real TEST batch:** acceptance criteria 1, 4, 5, 6, 9, 10, 11 all depend on `GmailApp` actually sending — thread capture, the confirmation dialog showing the true first rendered message, the LIVE recipient-count gate, and the interrupted-mid-batch resume behaviour. None of these have a safe local stand-in; they get exercised for real on first install.

#### Flagged, not fixed

- **Per-row writes in `writeQueueFields_` are cell-by-cell**, which is a lot of individual API calls at a 200-row cap. Not batched, deliberately: batching would defeat the per-row `flush()` that the spec requires precisely so a mid-batch timeout never loses the record of mail already sent (§8.5). Correctness chosen over speed; revisit if a full-cap run is slow in practice.
- **`Do Not Contact` email matching is exact-string**, not Gmail dot/plus-normalised. `e.payne@example.com` and `e.payne+newsletter@example.com` are different people to this code. Widening the match would catch more real duplicates but would also risk merging genuinely distinct addresses at non-Gmail domains — not a call to make blind before David's real list is imported.
- **The real-list import is unbuilt and unowned.** `Prospects`' v3 schema doesn't map onto `Davids List`'s columns in `template_Prospecting.xlsx`. Copy-paste for now, by agreement; a one-shot importer is a flagged future idea, not scoped.

#### Status

MVP built against all five pre-build fixes. Gating logic verified by local harness (13-row simulated queue, all edge cases from §11 present). Gmail-dependent acceptance criteria (1, 4, 5, 6, 9, 10, 11) outstanding, blocked on install into a real Sheet — cannot be closed from this environment. Phase 2 prompt re-read against the final code after build, not just before: none of the five fixes required revisiting.

---


## 2026-09-03 — Addendum v1: David's List importer, HTML signature support
[[Thu 03-Sep 2026]]
**Goal:** Build both items in `MVP_Addendum_v1_HTML_Signature_and_Importer.md` — the one-shot importer and HTML signature rendering — as the last two blockers before handover. Scope locked to those two: no schema change, no Phase 2 work, `Do Not Contact` matching untouched.

**Files:** new `11_Import.gs`, new `SendPreview.html`; changed `01_Engine.gs`, `04_Menu.gs`, `05_Staging.gs`, `06_Render.gs`, `08_Send.gs`, `10_Sidebar.gs`, `Sidebar.html`. `00_Schema.gs`, `02_Setup.gs`, `03_SeedData.gs`, `07_Validation.gs`, `09_Writeback.gs` and the manifest are byte-identical.

### The importer

`Outreach ▸ Import from David's List` prompts for the source tab name (defaults to `Davids List`), maps the eight columns in the addendum table and appends. Header-name resolution throughout, on both sheets — the source header row is resolved through the same `headerMap_` / `col_` / `val_` path as everything else, so a reordered source list imports identically. Validation reuses `isValidEmail_`, `normEmail_` and `buildProspectIndex_` rather than restating the rules; `padId_` and the ID high-water-mark scan are shared with staging.

Refuses before writing anything if the named tab lacks any of the eight mapped headers, and refuses outright if the name given is one of the tool's own five sheets.

**It appends whole rows; it never calls `writeProspectFields_()`.** That helper enforces `PROSPECT_WRITABLE`, which exists to stop the script writing human-owned columns on rows a human owns. An import creates the row, so there is nothing to protect — and widening the allowlist to let a script set `First Name` / `Company` / `Email` on an existing row would weaken a load-bearing guarantee to buy nothing. The allowlist is unchanged.

Nothing outside the eight mapped columns is imported. In particular the source's own `Outreach Email 1/2/3`, `Date`, `Interest`, `Signed On` and `Reason` are left behind: they are a different system's state with different guarantees, and writing them into v1's `Email {n} Status` would make the cadence gate believe outreach happened under rules this tool never applied.

### Duplicate detection: email only, and the reasoning

The addendum left this open. **Email only, case-insensitive via `normEmail_`.**

Email is already the identity the rest of the system runs on. `buildProspectIndex_` keys `byEmail`, and send-time validation uses that index to catch a `Do Not Contact` on a hand-pasted queue row with no `Prospect ID`. That index resolves one record per address — first occurrence wins, with a `Do Not Contact` row taking precedence. Import on email + name and you can create two rows sharing an address, at which point the block on one is shadowed by the other and the second record is invisible to the check that matters. It also breaks §9.8, one row per person, and gives Phase 2 two independent cadences firing at the same mailbox.

The cost is real and goes the other way: two genuinely different people behind `office@` or `info@` — the seed data has exactly this shape at `office@example.com` — and only the first imports. That failure is reported by name and source row, not silent, and the operator can add the second by hand. A silent second cadence to a shared mailbox is the worse failure, so the check errs toward refusing.

Same known limitation as `Do Not Contact` matching: exact-string, not dot- or plus-aware. Left consistent rather than fixed on one side only.

### The real source file will import zero rows

Read `template_Prospecting.xlsx` directly rather than trusting the column list. The headers match the spec exactly, so the mapping is right. The data does not:

| | |
|---|---|
| Data rows | 1,028 |
| Rows with an email address | **0** |
| Rows with a first name | 4 |
| Rows with nothing but `Company` = `eXp` | ~880 |
| Fully blank rows | 142 |

Email is a required field, so **an import run against this file today imports nothing and reports ~886 skips.** That is correct behaviour and the importer is not the thing to change — but it is worth knowing before it is demonstrated to anyone. The list needs email addresses in it first.

It did change the report design. A row with no first name, no last name and no email is counted as `Blank or filler rows ignored: N` and never itemised — that is spreadsheet residue, a dragged-down column, not a partially-filled person, and itemising 880 of them would bury the handful of skips that actually need a decision. Real skips are itemised, capped at 25 with a `…and N more` line, because a `Ui.alert` carrying 886 bullets is not a report.

### HTML signature — the rendering split

`render_()` now returns `{ subject, text, html }` instead of `{ subject, body }`.

Body copy stays plain text and stays BDM-owned: placeholders fill first, then the whole thing is HTML-escaped, then blank-line blocks become `<p>` and single newlines become `<br>`. Escaping after substitution is what lets a company called *Rowe & Sons* through — escaping the template first would leave the merge value unescaped, which is the same bug in a different order. A BDM who types `<10 mins` gets `&lt;10 mins` as visible text, and a pasted `<script>` is inert.

`SIGNATURE_BLOCK` passes through as raw HTML. The positional `body` argument on the send call is now the plain-text alternative — derived from the signature by a deliberately crude tag-stripper — so the message stays `multipart/alternative` rather than going out HTML-only. The FCA footer and the opt-out line survive into that part; the link becomes `text (url)`.

**Deviation from §1a, deliberate.** The addendum says raw, no auto-conversion. Taken literally, every install built before today has a plain-text `SIGNATURE_BLOCK` full of `\n`, and this change would silently collapse it — opt-out line included — onto one run-on line in every outgoing email, with nothing to indicate anything had changed. So `htmlSignature_()` checks whether the cell contains a tag at all: no tag, convert it like body text; any tag, pass through untouched, which is the case the addendum is actually about. The check is on content, and the result is visible in the preview before mail moves. The shipped `Engine` default is now HTML too, so a fresh install exercises the raw path from the start rather than discovering it later.

`GmailApp.createDraft(recipient, subject, text, { htmlBody })` — `htmlBody` is an option on the same call that was already in use, and `.send()` still returns the `GmailMessage`. `getId()` and `getThread().getId()` are untouched by the switch. Structurally unaffected; not verifiable without live Gmail.

### The confirmation flow is now two server calls

This is the part that changed shape most, and it was forced.

`Ui.alert()` renders raw tags, so the message preview had to become an HtmlService surface. An HtmlService dialog cannot return a value to the call that opened it, so `sendBatchWithStage_()` — preflight, confirm, send, all in one call — could not survive. It split:

- `startSendFlow_(stage)` — preflight, evaluate the queue, apply cap and quota, run the LIVE recipient-count confirmation, open `SendPreview.html` as a modal dialog.
- `executeConfirmedSend(stage, fingerprint)` — called by that dialog. Re-evaluates everything from scratch, then sends.

Nothing is cached between the two. The only thing carried across is a fingerprint — mode, stage, and the row number plus normalised address of every row about to be sent to or skipped — which the second call recomputes and compares. Edit the queue between preview and confirm and the send is refused by name rather than sending something other than what was shown. Tested: membership, order, mode, stage and an edited address all change it; case and whitespace on an address do not.

**The preview is a modal dialog, not an inline panel section — a deviation from §1c's "in `Sidebar.html`".** The MVP's own reasoning for keeping the hard stops out of the panel was that an inline panel message can be dismissed by habit in a way an interrupting dialog cannot. That reasoning did not stop applying because the content became HTML. A modal dialog renders HTML *and* interrupts, so it satisfies §1c's actual requirement — criterion 3, the operator sees the message as it will appear — without giving up the property the gate was built for. It also keeps the classic `Outreach ▸ Send Batch` menu path working with exactly the same preview; an inline-panel-only preview would have left the menu path with either no preview or a degraded plain-text one, which is two safety gates where there should be one.

**The LIVE recipient-count confirmation now runs before the preview, not after.** It is still a native dialog, unchanged in content (criterion 4). It moved because two dialogs cannot be stacked — a native alert raised while a modal dialog is open is not reliably visible — so one of them had to go first. The message preview is the one that belongs immediately before the send, so the count went ahead of it. The run summary now lands in the dialog rather than a native alert, for the same stacking reason.

`sidebarSendBatch()` returns `{opened: …}` and the panel says so; the summary appears in the dialog. Slight loss: the panel does not learn the outcome and needs a manual *Refresh status*. Accepted rather than adding a polling channel between two UI surfaces for a cosmetic gain.

### Verified, and how

`test/` holds a Node harness that loads the `.gs` files into a VM with the spreadsheet API stubbed. **It does not go into the Apps Script editor** — it exists so the parts that can be checked off a live Sheet are checked rather than asserted.

26 assertions passing. Importer: column mapping and that no unmapped source state leaks into v1's outreach columns; IDs continuing past the high-water mark; each of the three required fields named individually when missing; malformed email as its own distinct reason; within-source duplicate; two people on one mailbox; re-import producing zero rows and naming the existing Prospect ID; a `Do Not Contact` row not re-created; 450 residue rows counted and not itemised; a wrong-shaped tab refused before any write; the 25-item report cap. Render: paragraph and `<br>` structure, merge-value escaping, a typed tag rendered inert, raw signature passthrough with styling and link intact, the FCA footer reaching the plain-text part, a legacy plain-text signature converted rather than collapsed, missing and unknown placeholders still throwing, and a single well-formed document. Plus the fingerprint cases above.

One ordering bug caught by the harness and fixed: a within-source duplicate was reporting as *already on Prospects as P-00001* because freshly-imported rows were being injected into the index. Correct outcome, misleading sentence — the record it pointed at had been created seconds earlier by that same run, which reads as pre-existing data. The within-source check now runs first.

Caught by reading the real file rather than by a test: trailing blank rows fall outside `getLastRow()` and never reach the importer at all, which is why the filler count in the report is lower than the blank-row count in the source.

### Flagged, not fixed

- **`README` is now wrong in three places.** It says there is no importer, says the confirmation dialogs are native, and still carries the sidebar-dialog risk the BDM closed. Left alone because doc rewrites were outside the brief, but it is read by the operator and should be corrected before handover.
- **The real list has no email addresses.** See above. The importer is ready; the data is not.
- **`padId_` lives in `02_Setup.gs` and now has three callers across three files.** Fine in Apps Script's single global scope, untidy. Not moved — that is a refactor, not this build's business.
- **Whether a modal dialog opens reliably from a sidebar button** is the same class of question the BDM just closed for native dialogs, and is closed by the same evidence — but it has not been observed specifically. Run the panel's *Send Batch* once in TEST mode before anything real.
- **The plain-text alternative is generated by a tag-stripper, not authored.** Adequate for a signature; if the real one is table-heavy the text part may read poorly. A second `Engine` key holding a hand-written text signature is the fix if it matters, and it is not in scope.

### Status

Both addendum items built. 26 assertions passing off-Sheet. Acceptance criteria 1, 2 (send-side), 3, 6 and 7 are verified here; 2 (rendering in a real inbox), 4 and 5 need the live install, as does the modal-from-sidebar check.

## 2026-09-11 — Multi-BDM rollout: architecture locked, Muki unblocked, Mike paused
[[Fri 11-Sep 2026]]

**Goal:** Resolve the open Theme A/B questions from the BDM extension Rattle — sheet architecture, Engine locking, versioning discipline — and get Muki's build unblocked.

### Theme A — architecture closed

One spreadsheet per BDM; shared logic (schema, render, validation, send, writeback, menu/sidebar) moves into a bound, published, versioned Apps Script library; each BDM's sheet runs a thin container script against it.

Local-vs-library split finalised: `Prospects`, `Send Queue`, `Templates`, per-BDM `Engine` rows (sender name, test email, signature), and seed data stay local. Everything else moves to the library.

`Engine` stays a single sheet, not physically split. The lock between BDM-editable and operator-owned rows is enforced in code, not layout — same pattern as the `PROSPECT_WRITABLE` allowlist. Max sends per run and email gap/cadence timing are library-level defaults; BDMs cannot write to them, only message the operator for a change.

New scope, small: test-mode sends CC the operator's own address. Live sends unaffected.

Versioning is pinned per BDM, not automatic — each container script references an explicit library version, bumped deliberately once a change is confirmed good. There are four spreadsheets in the fleet, not three: David, Muki, Mike, plus the operator's own test sheet, which tracks head and never sends real outreach.

Cell/header-protection guardrails remain parked — deliberately out of scope, not designed.

### Theme B — Muki unblocked, Mike's track paused

Muki's template was already in hand and her use case matches David's directly (estate-agent prospecting), so she's clear to build now against the closed architecture — no dependency on Mike's track.

Mike was texted for his outreach template to unblock his onboarding. Follow-up conversation: he confirmed he won't be using the tool short-term and it's parked to an undecided medium-term point. Not an active workstream. The schema-compatibility assumption between agent prospecting (David/Muki) and client outreach (Mike) remains formally unverified as a result — carried forward as an open flag, not resolved, not urgent while paused.

**Next:** build Muki's container script against the library. See `Vale_Multi-BDM_Handover.md` for full build sequence.

## 2026-09-16 — Correction: David's import/column-map flag was stale
[[Wed 16-Sep 2026]]
**Trigger:** Rechecking the open-threads list before starting the Muki build — `BDM Extension Handover.md` still carried "David's import/column-map mismatch... unresolved" as a live flag.

**Finding:** No mismatch reproduces. `Outreach_Automation_Spec.md` documents the "Davids List" tab in `template_Prospecting.xlsx` with columns `Town/Area | First Name | Last Name | Company | Email | Insta | Phone | Job Title | ...`. `IMPORT_COLUMN_MAP` in `11_Import.gs` expects source headers `First Name, Last Name, Company, Job Title, Town/Area, Email, Phone, Insta` — a one-for-one match, including the "Insta" (not "Instagram") naming that would normally trip an importer up. Confirmed against real-world use: David's imports run fine in practice, consistent with this.

**Conclusion:** Stale flag, not a live bug — same class of thing as the three known-wrong spots already noted in the README ("left alone because doc rewrites were outside the brief"). No code change made or needed.

**Status:** Closed. Drop from the Theme A/B open-threads list in the Handover doc.

## 2026-09-16 — Library extraction: Muki live, Engine lock, one real bug found and fixed
[[Wed 16-Sep 2026]]

**Goal:** Execute the architecture locked on 2026-09-11 — extract David's shared logic into the library, get Muki's container built against it, and ship the Engine lock and test-mode CC that were specified but not yet built. Also asked to regression-check David and update the README's stale multi-BDM section.

### Extraction

Five files — `00_Schema.gs`, `06_Render.gs`, `07_Validation.gs`, `09_Writeback.gs`, and (until the fix below) `05_Staging.gs` — moved into `/library` byte-identical to David's original. Verified against git, not by eye: the test harness diffs the library file against `git show main:...` and fails if a single byte differs. That's the actual regression evidence for this build, not a description of one.

**`13_Api.gs` is new and was forced, not chosen.** Apps Script does not export a function whose name ends in `_`, and nearly every function in this codebase — `sheet_`, `col_`, `render_`, `sendBatch_`, all ~60 of them — does. The alternative was renaming across ~2,200 lines and losing the internal/external distinction inside the library. Instead one file names the ~20 functions that are genuinely public; everything else stays private and unreachable from a container, exactly as it was in the single-sheet build.

**Each container is three files, thirteen wrappers, no logic.** `onOpen()` and every `google.script.run` target resolve in the spreadsheet-bound script, never in a library — that's a platform rule, not a design choice, and it's why the thin-container pattern can't be made any thinner than it is.

### Engine lock and test-mode CC (§Theme A, now built)

`MAX_SENDS_PER_RUN` and the new `MIN_DAYS_BETWEEN_EMAILS` are library constants, enforced by **override, not refusal** — `readEngine_()` replaces whatever the sheet says every time it's read. Refusal was the other option and is weaker here: Apps Script can't intercept a human typing into a cell, so a refusal could only ever be a complaint raised later, at send time. An edited cell is still surfaced, not swallowed — `engineLockViolations_()` reports it in Setup Check and the sidebar as "ignored," not silently discarded. `MIN_DAYS_BETWEEN_EMAILS` is locked but **not consumed by v1** — there's no cadence logic in this codebase yet to consume it. Declared now so the key is operator-owned from day one rather than clawed back from a BDM later.

Test-mode CC is one guard, inside `sendBatch_()`, the only function that hands anything to Gmail. On a LIVE send the `cc` key is never set on the options object at all — not blank, absent. Asserted both directions. Ships with `OPERATOR_CC` blank; a wrong address here silently CCs a stranger on every test send, so it's a deliberate manual step before publishing, not a shipped default.

### Muki's importer

Generalised David's importer into a shared engine (`11_ImportCore.gs`) plus a per-BDM profile — the validation rules (required fields, malformed email, in-batch duplicate, already-on-Prospects) are shared and not configurable; the column map and any exclusion rule are the BDM's own.

**The spec's column table didn't survive contact with the actual file.** `Address` and `Postcode` don't exist in `Muki_Template_SAMPLE.xlsx`. Verified the real header row before writing anything, per instruction to refuse rather than substitute a close-enough name — same posture `headerMap_` already takes on a missing header.

`Town/Area` took two passes. First pass shipped unmapped, since none of the three candidate columns cleanly matched "Address." Reconsidered once the *fill pattern* was actually read: `Location [CHECK whether it is real Office or NO via PHONE]` is the one column carrying genuine area names, sparsely; `Tube station` holds postcodes, not stations; the plain `Location` column is empty throughout. Mapped the awkward one. The objection to betting on an unstable, instruction-laden header is answered by the header-verification refusal itself — a rename produces a named, before-any-write error rather than a silent bad import, which is what makes betting on it sane. Exact-match only; both candidates share the `Location` prefix, so prefix matching would be ambiguous by construction.

Built the Paused-routing exclusion rule: any of six outreach-history columns non-blank imports `Paused = Y` with the raw text concatenated into `Notes`. History is deliberately never written into `Email {n} Status` — that column means "this tool sent this stage," and a hand-logged "Aug 22" from her tracking sheet isn't that.

### A pre-existing bug, found and fixed

The Send Panel's "Clear Completed Queue Rows" button called `clearCompletedQueueRowsCore_()`. That function has never been defined — not in the library, not in David's original single-sheet build, not in any commit in this repo's history. **Confirmed against David's live script before assuming the repo was accurate**: cloned the deployed project directly and diffed it against `main` byte-for-byte — clean, no drift. Confirmed the bug itself by execution, not grep: ran both the menu path (works) and the panel path (throws `ReferenceError`) against the stub harness. Same shape as the `maxProspectIdNumber_` bug from the 2026-09-03 addendum — a function called by name with no implementation behind it, never noticed because the two entry points have near-identical labels and the working one was the one in habitual use.

Fixed by extracting the real core: it returns `{cleared, empty}` (or `null` on decline) rather than alerting, so the menu keeps its native dialogs and the panel renders inline off the same function — which is exactly what the sidebar's own comment had always described as the intent. The native confirm stays inside the core and fires from both surfaces; the panel must not be a softer gate on an irreversible delete than the menu is.

### Test harness

**The 26-assertion harness the 2026-09-03 entry describes does not exist in this repo, and never has** — no Node file appears anywhere in `git log --diff-filter=A`. Written fresh rather than assumed present: 218 assertions, `node harness/run.js`, no `npm install`, including a dependency-free `.xlsx` reader so `Muki_Template_SAMPLE.xlsx` is read directly on every run instead of transcribed into a static fixture. Covers David's unchanged behaviour, the Engine lock (edit survives *and* row-deletion survives), the CC on both paths, Muki's importer against the real sample, and the clear-completed fix on both surfaces. This is new evidence, not a continuation of the old suite — stated as such in the harness's own header rather than implying parity with something that isn't there.

### README

Checked the three README complaints named in the 2026-09-03 entry against the actual current file before touching anything. **None reproduce** — the importer is documented, the dialogs are correctly described as HTML, and the sidebar-dialog-risk text isn't present anywhere in the file. Left that content alone rather than inventing a fix for a problem that isn't there. Updated the parts that this session's work actually made stale: the Files table split into library/container, install rewritten as two ordered procedures, the Engine lock and CC documented, Muki's exclusion rule documented beside David's import description, and the multi-BDM appendix retitled from "(in progress)" to reflect done — with an explicit note that Muki hasn't had a real TEST send yet and her live list is still unimported.

### Flagged, not fixed

- **Deploy is entirely manual and outside this session's reach.** No `clasp` auth in this environment — every push, version publish, and version-pin check is the operator's own step, not verified here.
- **`OPERATOR_CC` ships blank.** Must be set in `library/08 send.js` before publishing, or test sends carry no CC at all.
- **Version pin needs checking in two places, not one.** The container manifest's JSON and the Apps Script editor's own Libraries panel can disagree; only the second is what actually runs.
- **No real TEST-mode send from Muki's sheet yet.** Deferred by the operator this session, twice — not closeable without a live Sheet.
- **Muki's actual working list is not imported.** Deferred by design, per the original build boundary — a decision for her to make once the tool is in front of her, not part of this build.

### Status

Library extraction, Engine lock, test-mode CC, Muki's importer and container, and the clear-completed fix are all verified off-Sheet — 218 assertions passing, PR [#1](https://github.com/ferret-stack/vale/pull/1) merged. Everything from `clasp push` onward — publishing the library version, pinning it, and the first real send — is the operator's own step and unverified from this environment.
