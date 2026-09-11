# Bulk Email Outreach Tool — Build Spec

## Source data
Sheet: **"Davids List"** in `template_Prospecting.xlsx`

Existing columns:
`Town/Area | First Name | Last Name | Company | Email | Insta | Phone | Job Title | Outreach Email 1 | Date | Followed on Instagram | Instagram DM | Headline Fee Offered | LinkedIn Connection | Outreach LinkedIn | Whatsapp DM | Outreach Email 2 | Outreach Email 3 | Interest | Signed On | Reason`

New columns to add:
- `Paused` — manual override, any non-blank value = skip row entirely
- `Reply Detected` — Y/N, set automatically when a reply is found in Gmail
- `Last Reply Date` — timestamp of most recent detected reply

---

## Daily automated run (time-driven trigger, once per day)

For each row, in order:

1. **Skip** the row if `Paused`, `Interest`, `Signed On`, or `Reason` is non-blank.
2. **Reply check first**: search Gmail for a reply from this prospect's email address in the outreach thread.
   - If found and `Reply Detected` isn't already `Y`: set `Reply Detected = Y`, stamp `Last Reply Date`, and skip further sending for this row (no more emails go out once a reply exists).
3. **Send Email 1** if `Outreach Email 1` is blank and `Email` is present. On send: set `Outreach Email 1 = Y`, `Date = today`.
4. **Send Email 2** if `Outreach Email 1 = Y`, `Outreach Email 2` is blank, and today ≥ `Date + 3 days`. On send: set `Outreach Email 2 = Y`, `Date = today` (overwrite — `Date` always means "date of last outreach").
5. **Send Email 3** under the same logic, gated on `Outreach Email 2 = Y` + 3 days + blank `Outreach Email 3`.
6. After Email 3 sends, no further automated action — row is fully touched, waiting on a human.

**Safety caps:**
- Max sends per run (configurable, e.g. 50) — hard stop even if more rows qualify.
- Dry-run mode flag — when on, logs what *would* send/update without actually sending or writing to the sheet.

---

## Email templates

Separate **"Templates"** sheet, one row per stage (Email 1 / 2 / 3), columns for Subject and Body. Placeholders: `{{FirstName}}`, `{{Company}}`, `{{TownArea}}`, `{{JobTitle}}`. Editable by your cofounder without touching code.

## Sending mechanism

`GmailApp.sendEmail()` — sends from your cofounder's own Gmail address, keeps replies in a natural thread, avoids extra infrastructure. Note free Gmail's ~100/day send quota (Workspace accounts get more).

## Reply detection (v1 — rules-based)

- Search Gmail threads for the outreach conversation with each prospect's email.
- Detect presence of a reply only — do **not** attempt to classify sentiment/interest in v1.
- Flag via `Reply Detected` column and include in the daily roundup email for manual review.

## Daily roundup email (to your cofounder)

Sent at the end of each run, summarizing:
- How many Email 1 / 2 / 3 sends went out today
- Who replied today (needs manual review) — name + email, linked to their row
- Who's scheduled for their next email tomorrow, and which stage
- Any rows that hit the max-send cap and were held back

## UI (custom menu via `onOpen()`)

- **Outreach ▶ Send Today's Batch** (manual trigger, same logic as the daily run)
- **Outreach ▶ Preview Next Batch (Dry Run)**
- **Outreach ▶ Set Up Daily Trigger**
- **Outreach ▶ Check Replies Now**

## Phase 2 (stretch goal — not in v1)

Integrate Gemini (via the Gemini API or Vertex AI) to read reply text and classify interest level (interested / not interested / out-of-office / needs follow-up), auto-suggesting a value for the `Interest` column instead of just flagging "needs manual review."

---

## Open items for next session
- Confirm max-sends-per-run number
- Confirm exact 3-day gap is right for all three stages, or wants tuning
- Decide where the roundup email should be sent (cofounder's inbox, shared inbox, etc.)
- Draft actual copy for Email 1 / 2 / 3 templates
