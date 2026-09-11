# Phase 2 Prompt (v3) — use only after the MVP is signed off
#united-mortgages/Vale 
Supersedes the earlier Phase 2 prompts. Paste the text below to the building agent with [[Vale MVP Build Spec]] and the built project attached.

---

The MVP outreach sender has been reviewed and accepted. Extend it into an automated cadence engine with reply detection.

Everything in the MVP spec still holds unless overridden here. In particular: `Do Not Contact` and `Paused` remain absolute blocks; only `Status = SENT` or `FAILED` gate a stage — `TEST-SENT` never blocks; writeback still keys on `Prospect ID` only; columns are still resolved by header name at runtime; all sending still goes through the single send function; `Engine!MODE` still governs every code path with no exceptions; and any genuine credential (the Gemini API key in §7) goes in `PropertiesService`, never in a sheet cell, however well hidden.

The Phase 2 columns already exist on `Prospects`, empty. No migration should be needed — if you find yourself needing one, stop and flag it.

Build in this order, each step independently testable.

## 1. Cadence enrolment

Automated runs read from `Prospects`. `Send Queue` remains the manual-batch surface, unaffected.

- `Auto Cadence` — `Y` opts a row in. Blank = manual only. **Opt-in, not opt-out.**
- `Cadence Status` — `ACTIVE` \| `REPLIED` \| `COMPLETE` \| `HELD`

## 2. Eligibility

All must hold:

- `Auto Cadence = Y`
- `Do Not Contact`, `Paused`, `Interest`, `Signed On` all blank
- `Reply Detected` is not `Y`
- `Email` present and well-formed
- Stage gate (only `SENT`/`FAILED` count as "touched" — `TEST-SENT` is invisible to this logic):
  - **Stage 1** — `Email 1 Status` blank
  - **Stage 2** — `Email 1 Status = SENT`, `Email 2 Status` blank, `today ≥ Email 1 Date + GAP_1_2`
  - **Stage 3** — `Email 2 Status = SENT`, `Email 3 Status` blank, `today ≥ Email 2 Date + GAP_2_3`

A row whose current-stage status is `FAILED` goes to `Cadence Status = HELD` and appears in the roundup — never silently retried, never silently skipped.

Compute gaps from `Email {n} Date`, never `Last Contacted` (touched by every send including test sends, not stage-specific).

`GAP_1_2` / `GAP_2_3` — new `Engine` keys, default 3 days. `ROUNDUP_TO` — new `Engine` key, default the operator.

After Stage 3 sends, `Cadence Status = COMPLETE`.

## 3. Reply detection — runs before any sending in every run

- Fetch by `Thread ID` via `GmailApp.getThreadById()`. **Never search by From-address** — matches unrelated mail and permanently halts outreach to good prospects on a false positive.
- Reply exists if the thread has a message from someone other than the operator, dated after `Last Contacted`.
- On detection: `Reply Detected = Y`, stamp `Last Reply Date`, `Cadence Status = REPLIED`, no further sends to that row ever.
- Rows with no `Thread ID` can't be checked — count and report, never guess.

Presence only, no sentiment/intent classification in this phase.

## 4. Daily trigger

- `Outreach ▸ Set Up Daily Trigger` / `Remove Daily Trigger`. Setup twice must not create two triggers.
- Calls the same send function as the manual batch.
- Respects `MAX_SENDS_PER_RUN` and `MailApp.getRemainingDailyQuota()` (Workspace: 1,500 recipients/day).
- ~6-minute execution ceiling: write per-row state immediately; on approaching the limit, exit cleanly, report the remainder, resume next run with zero duplicates.
- `Engine!MODE` still governs. A trigger installed while `MODE = TEST` sends real test emails to `TEST_EMAIL` and writes `TEST-SENT` — it does not silently escalate to `LIVE`.

## 5. Threaded follow-ups

Emails 2/3 reply into the existing `Thread ID` rather than opening a new conversation. Fall back to a fresh thread if it's gone, update `Thread ID`, note it.

## 6. Daily roundup email

To `ROUNDUP_TO`, end of every run: Stage 1/2/3 counts, who replied today (name, email, row link), who's due tomorrow and at which stage, rows held back by cap, rows in `HELD` with reasons, failures, remaining quota. Send even on a zero-send run — silence is indistinguishable from a dead trigger.

## 7. Stretch — AI reply classification

Only once 1–6 are stable. Gemini API classifies replies as `interested` / `not interested` / `out of office` / `needs follow-up`, written to a new `Interest (suggested)` column — never to `Interest`, which gates the cadence and stays human-controlled. The Gemini API key is stored via `PropertiesService.getScriptProperties()`, set once by the operator through the Apps Script editor, never as an `Engine` cell. Out-of-office holds the row N days rather than ending the cadence.

## 8. Acceptance criteria

1. A row with `Auto Cadence` blank is never touched by the trigger.
2. A row with `Email 1 Date` 2 days ago gets no Stage 2 email; at 3 days it does.
3. A row with `Email 1 Status = FAILED` lands in `HELD`, appears in the roundup, is neither sent nor silently skipped.
4. A row with `Email 1 Status = TEST-SENT` and nothing else is still eligible for a real Stage 1 send.
5. A reply in a tracked thread stops all further sends to that row on the next run.
6. A reply from the same address in an unrelated thread does **not** stop the cadence.
7. Two trigger runs in one day send each eligible row at most once.
8. A run terminated at the execution limit resumes next run with zero duplicates.
9. With `Engine!MODE = TEST`, a full triggered run sends real test emails and writes `TEST-SENT`, and still produces a roundup.
10. Stage 2 arrives in the same Gmail thread as Stage 1.
11. No column was added to `Prospects` that didn't already exist in the MVP schema.
12. The Gemini API key does not appear anywhere in the spreadsheet.
