# Outreach MVP — Build Spec (v3)
#united-mortgages/Vale 
**Supersedes v2.** Confirmed: sending account is Google Workspace Gmail — Apps Script quota 1,500 recipients/day.

Two changes from v2, both reflected throughout: (1) "dry run" now performs a genuine send to an internal test address, not a no-op preview; (2) all operational configuration moves to a new hidden `Engine` sheet, replacing `Config`.

**Platform:** Google Sheets + container-bound Apps Script. **Distribution:** Drive ▸ *Make a copy*.
**What this is:** a manually-triggered, human-gated batch sender with logging and editable templates.
**What this is not:** a cadence engine, a reply reader, a scraper. See §10.
**Governing constraint:** Phase 2 (automated cadence + reply detection) is certain, not speculative. §9 lists what must not be violated to keep it an additive change.

---

## 1. Workbook structure

Six sheets: `Prospects`, `Send Queue`, `Templates`, `Engine` (hidden), `Run Log`.

**Column access rule (mandatory):** all code resolves columns by reading the header row into a name→index map at runtime. Never hardcode column letters or indices.

---

## 2. `Prospects` — the contact log

One row = one human being, never a firm or aggregate.

**Identity & contact (human-entered)**

`Prospect ID` (script-assigned, `P-00001`, immutable, never reused — the join key for everything) · `First Name`* · `Last Name` · `Company`* · `Job Title` · `Town/Area` · `Email`* · `Phone` · `Instagram` · `LinkedIn URL` · `Website` · `Source` · `Date Added`
(* required to send)

**Control (human-entered)**

`Do Not Contact` (any non-blank = absolute block, everywhere, forever, overrides all) · `Paused` (temporary block) · `Interest` · `Signed On` · `Notes`

**Email outreach state (script-written only)**

| Column | Values |
|---|---|
| `Email 1 Status` | blank \| `SENT` \| `FAILED` \| `TEST-SENT` |
| `Email 1 Date` | |
| `Email 2 Status` | same enum |
| `Email 2 Date` | |
| `Email 3 Status` | same enum |
| `Email 3 Date` | |
| `Thread ID` | Gmail thread ID |
| `Last Message ID` | |
| `Last Contacted` | timestamp of most recent send, any stage, any mode |

**`TEST-SENT` never blocks anything.** Only `SENT` and `FAILED` gate future sends. This is deliberate: a test run must prove the pipeline works — template rendering, thread capture, writeback — without ever preventing the real send that follows. Never infer "not yet sent" from a blank cell alone; always compare against the enum explicitly.

**Phase 2 reserved (create now, empty, untouched by v1 code)**

`Auto Cadence` · `Reply Detected` · `Last Reply Date` · `Cadence Status` · `Interest (suggested)`

**Other channels (human-maintained, script never touches)**

`Instagram DM Sent` · `LinkedIn Connected` · `WhatsApp Sent` · `Fee Offered`

---

## 3. `Send Queue` — the gated send surface

Kept as a separate sheet from `Prospects`, deliberately. `Prospect ID` removes the old technical objection (no reliable join key), but the sheet earns its place on a different ground: it stays small and gets cleared after each batch, so the human is reviewing a handful of gated rows, not scanning a `Send?` column in a log that will be thousands of rows deep within months. That's a guardrail against an accidental mass send, not just plumbing.

The batch runner reads **only** this sheet, never `Prospects` directly.

| Column | Written by |
|---|---|
| `Prospect ID` | script on stage — blank if hand-pasted (sends, but reported *unlinked*, no writeback) |
| `Send?` | **human** — `Y` = eligible, anything else ignored |
| `Email`, `First Name`, `Company`, `Job Title`, `Town/Area` | script on stage |
| `Status` | script — blank \| `SENT` \| `FAILED` \| `SKIPPED` \| `TEST-SENT` |
| `Stage` | script — 1/2/3, whichever was chosen for the run |
| `Sent At`, `Thread ID`, `Message ID`, `Notes` | script |

Eligible only when `Send? = Y` and `Status` is blank. Any non-blank status blocks until a human clears it or runs *Clear Completed Queue Rows*.

---

## 4. `Templates`

`Stage` (1/2/3) · `Name` · `Subject` · `Body` (plain text only) · `Active` (Y/N, exactly one per stage).
Placeholders: `{{FirstName}}`, `{{Company}}`, `{{JobTitle}}`, `{{TownArea}}`.
Ship all three stages with plausible draft copy so the sheet is testable on first open.

---

## 5. `Engine` (hidden sheet)

Key/value, read fresh at the start of every run. Hidden via `Sheet.hideSheet()` so the BDM never needs to open it to run a batch — stage is chosen via a dialog at send time (§7), not read from here.

| Key | Default | Notes |
|---|---|---|
| `MODE` | `TEST` | `TEST` \| `LIVE`. The only real switch — controls everything downstream. |
| `TEST_EMAIL` | *(placeholder, e.g. `tech@yourcompany.com`)* | Where every message goes in `TEST` mode. Run aborts if blank while `MODE = TEST`. |
| `MAX_SENDS_PER_RUN` | `200` | |
| `SENDER_NAME` | | |
| `REPLY_TO` | | Optional |
| `SIGNATURE_BLOCK` | *(pre-filled placeholder)* | Appended to every body. Run aborts if blank. Must contain sender identity and a working opt-out line. |

**Do not treat this sheet as a secrets store.** Distribution is *Make a copy* — the BDM owns their file outright, and a hidden sheet is one click away for a file's own owner (`View ▸ Show hidden sheets`). Everything above is operational config, fine to sit in cells. If Phase 2 introduces an actual credential (a Gemini API key), it goes in Apps Script's `PropertiesService`, which never renders in the spreadsheet at all — not in `Engine`, however well hidden.

`LIVE` mode is implemented but locked: selecting it and running a batch raises a confirmation dialog naming the exact recipient count, and refuses to proceed if `SIGNATURE_BLOCK` is blank.

---

## 6. `Run Log`

Append-only, one row per run: timestamp, operator email, mode, stage, evaluated, sent, skipped, failed, unlinked, held back by cap, quota remaining.

---

## 7. Menu (`onOpen`)

- **Outreach ▸ Add Prospects to Send Queue**
- **Outreach ▸ Validate Send Queue**
- **Outreach ▸ Send Batch** — prompts for stage (1/2/3) via dialog, then runs according to `Engine!MODE`. Shows the first fully-rendered message and total count in a confirmation dialog before anything sends.
- **Outreach ▸ Clear Completed Queue Rows**
- **Outreach ▸ Setup Check** — read-only: current mode, active templates, quota remaining. Does not reveal `Engine` cell contents directly.

No time-driven triggers in v1.

---

## 8. Run behaviour

### Staging
Per selected `Prospects` row: assign `Prospect ID` if blank; skip if `Do Not Contact` or `Paused` non-blank, or already `SENT` in `Send Queue` for this stage. Copy merge fields across. Leave `Send?` blank.

### Pre-flight
Abort with a clear message if: no `Active = Y` template for the chosen stage; `SIGNATURE_BLOCK` blank; `MODE = TEST` and `TEST_EMAIL` blank. Check `MailApp.getRemainingDailyQuota()`; cap and report if short.

Validate every eligible row: email present and well-formed; duplicates within the batch → all but first `SKIPPED — duplicate in batch`; every placeholder the active template uses has a non-empty value on that row. **A missing placeholder value is a validation failure, never a blank substitution** — don't send `Hi ,`. Invalid rows are marked `SKIPPED` with a reason; the rest of the batch proceeds.

### Per row, sequentially
1. Render subject + body, append `SIGNATURE_BLOCK`.
2. `TEST` — send to `Engine!TEST_EMAIL`, subject prefixed `[TEST → intended@real.com]`. This is a genuine send: capture and write everything a live run would, using `Status = TEST-SENT`.
3. `LIVE` — `GmailApp.sendEmail()` to the prospect, `Status = SENT`.
4. Capture `Thread ID` and `Message ID` from the sent message in both modes.
5. Write `Status`, `Stage`, `Sent At`, `Thread ID`, `Message ID` to `Send Queue`, write back to `Prospects`, then `SpreadsheetApp.flush()` — **immediately, per row.** Apps Script has a ~6-minute ceiling; a timeout must never lose the record of mail already sent.
6. try/catch per row: failure → `Status = FAILED` + `Notes = <error>`, continue.
7. Stop at `MAX_SENDS_PER_RUN`; report held-back rows.

### Writeback to `Prospects`
Keyed on `Prospect ID` only, never name/company/email. Not found → `Notes = writeback failed` on the queue row, continue.
Success: `Email {stage} Status = SENT` or `TEST-SENT` (matching the mode), `Email {stage} Date = now`, `Last Contacted = now`, `Thread ID`, `Last Message ID`.
Failure: `Email {stage} Status = FAILED`.

### Summary
Dialog at end of run plus a `Run Log` row.

---

## 9. Phase 2 forward-compatibility — do not violate

1. Per-stage dates, never a single date, as the cadence input.
2. `Thread ID` captured on every real send (test or live) — cannot be retrofitted onto mail already sent.
3. `Prospect ID` immutable, never reused.
4. Status as an explicit enum (`SENT` / `FAILED` block; `TEST-SENT` never does), never blank-vs-non-blank inference.
5. Columns resolved by header name at runtime.
6. All sending behind one function taking (rows, stage, mode) — Phase 2's trigger calls the same path.
7. `Engine!MODE` governs every code path, no exceptions.
8. One row per person.
9. Real secrets go in `PropertiesService`, not sheet cells, from the first one onward.

---

## 10. Explicitly NOT in this build

Time-driven triggers · reply detection or Gmail searching · cadence gap logic · auto-progression 1→2→3 · roundup email · AI classification · contact scraping · HTML email · attachments · tracking.

---

## 11. Seed data

15 dummy prospects with realistic names/companies/emails. Deliberate edge cases: one missing `First Name`, one malformed email, one duplicate email, one `Do Not Contact`.

---

## 12. Acceptance criteria

1. Fresh copy opens with the menu present, `Engine` hidden, `MODE = TEST`, 15 dummy rows, three populated templates.
2. Staging 5 selected prospects creates 5 queue rows, `Send?` blank, IDs assigned.
3. The `Do Not Contact` row cannot be staged, reports why.
4. `Send Batch` in `TEST` mode on 5 gated rows shows a confirmation dialog with the first rendered message, then — on confirm — sends 5 real emails to `Engine!TEST_EMAIL` with the `[TEST →]` subject prefix.
5. Those 5 rows get `Status = TEST-SENT` and populated `Thread ID`/`Message ID` on both `Send Queue` and `Prospects`.
6. A subsequent `LIVE` run on the same rows is **not blocked** by the prior `TEST-SENT` and proceeds normally.
7. The missing-`First Name` row is a validation failure, never sent with a gap.
8. The malformed email and the duplicate are `SKIPPED` with distinct reasons; the rest of the batch still sends.
9. `LIVE` mode requires an explicit confirmation naming the recipient count and refuses to run with a blank `SIGNATURE_BLOCK`.
10. Re-running `Send Batch` immediately after a successful `LIVE` run sends nothing (`SENT` blocks).
11. A run interrupted mid-batch leaves every already-sent row correctly marked.
12. `MAX_SENDS_PER_RUN = 3` with 10 eligible sends exactly 3, reports 7 held back.
13. Deleting a `Prospects` column and re-adding it elsewhere doesn't break the script.
14. The BDM can complete a full test batch without ever opening `Engine`.
