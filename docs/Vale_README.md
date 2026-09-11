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

| File | Responsibility |
|---|---|
| `appsscript.json` | Manifest — scopes, timezone, runtime |
| `00_Schema.gs` | Sheet/column names, the `STATUS` enum, placeholder map. **Nothing else in the project may hardcode a column letter or index.** |
| `01_Engine.gs` | Reads `Engine` fresh every run; template lookup |
| `02_Setup.gs` | `setupWorkbook()` — run once on a blank Sheet |
| `03_SeedData.gs` | 15 dummy prospects + 3 draft templates |
| `04_Menu.gs` | `onOpen()` menu, dialog helpers |
| `05_Staging.gs` | Moves selected `Prospects` rows into `Send Queue`; core is shared with the sidebar |
| `06_Render.gs` | Fills `{{Placeholders}}`; refuses to send a blank |
| `07_Validation.gs` | Eligibility checks shared by Validate, Send, and the sidebar |
| `08_Send.gs` | The single send choke point, confirmations, lock, time budget |
| `09_Writeback.gs` | Writes results back to `Prospects`, keyed on Prospect ID; appends `Run Log` |
| `10_Sidebar.gs` | Server-side entry points for the Send Panel — thin wrappers around the same functions the menu uses, nothing duplicated |
| `11_Import.gs` | One-shot import from a Davids-List-shaped tab into `Prospects` |
| `Sidebar.html` | The Send Panel itself — stage dropdown, live status, inline Stage/Validate results |
| `SendPreview.html` | Modal dialog showing the first message as real rendered HTML — the send confirmation, triggered by both the menu and the panel |

## Install

1. Create a **blank** Google Sheet.
2. Extensions ▸ Apps Script.
3. Delete the default `Code.gs`. Create each `.gs` file above by name (keep the numeric prefixes — load order matters) and paste its contents. For `Sidebar.html` and `SendPreview.html`, use the editor's **+ ▸ HTML** option and name each file to match (no extension needed in the editor — `Sidebar` and `SendPreview`).
4. Project Settings ▸ check *Show "appsscript.json" manifest file in editor* ▸ open it ▸ replace with `appsscript.json`.
5. Run `setupWorkbook()` from the editor (select it in the function dropdown ▸ Run). Approve the permissions prompt.
6. Back in the Sheet: View ▸ Show hidden sheets ▸ `Engine`. Replace the three placeholder values:
   - `TEST_EMAIL` — a real address you control
   - `SENDER_NAME`
   - `SIGNATURE_BLOCK` — must include a working opt-out line. Plain text or real HTML both work; paste the actual company signature here, tags and all, if you have one.
7. Reload the Sheet. The **Outreach** menu appears, with **Open Send Panel** at the top.

Sending is refused while any of the three above still holds its shipped placeholder text — this is checked by content, not just by blank-ness, so a forgotten default can't slip through as "configured."

## Distribution

Drive ▸ *Make a copy*. Each user owns their own file outright; there's no shared backend. `Engine` is hidden but **not a secrets store** — a hidden sheet is one click away for a file's own owner. It only ever holds operational config (mode, cap, sender name, signature). If Phase 2 introduces a real credential (e.g. a Gemini API key), it belongs in Apps Script's `PropertiesService`, never in a sheet cell.

## Day-to-day use

**Outreach ▸ Open Send Panel** is the primary way to run a batch — everything below happens inline in one panel, no menu-hunting or text prompts.

0. **First time only, or whenever David's List has new people on it:** paste the source list into its own tab (keeping its header row), then **Outreach ▸ Import from David's List**. You'll be asked for the tab name — it defaults to "Davids List". Reports what was imported and what wasn't, with a reason for every skip (missing field, malformed email, already on Prospects). Safe to re-run: anyone already imported is recognised by email and skipped, never duplicated.
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

**The importer matches on email only, not email + name.** Email is already the identity the rest of the system runs on — the `Do Not Contact` check above depends on it. Matching on name too would let one address end up on two `Prospects` rows, and a block on one would be invisible to the other. The cost lands on shared mailboxes: two different people both reachable at `office@company.com` only get the first one imported — reported by name and source row, not silent, so the second can be added by hand.

## What this is not (Phase 2 territory)

Time-driven triggers, reply detection / Gmail searching, cadence gap logic, auto-progression through stages, the roundup email, AI reply classification, attachments, tracking pixels. All of `Prospects`' Phase 2 columns already exist, empty, untouched by this code — Phase 2 should need no schema migration if it's built to the Phase 2 prompt.


## Multi-BDM architecture (in progress)

This document describes the single-sheet MVP as originally built for David. As of [[Fri 11-Sep 2026#Vale — Multi-BDM Rollout (Theme A)|11 Sept]], the project is migrating to a multi-BDM model:

- **Structure:** one spreadsheet per BDM, not a shared sheet. Shared logic (`00_Schema.gs` through `09_Writeback.gs`, `10_Sidebar.gs`, `Sidebar.html`) is being extracted into a single bound, published, versioned Apps Script library. Each BDM's spreadsheet keeps only a thin container script.
- **Stays local per BDM:** `Prospects`, `Send Queue`, `Templates`, seed data, and the per-BDM rows of `Engine` (`SENDER_NAME`, `TEST_EMAIL`, `SIGNATURE_BLOCK`).
- **Moves to the library:** everything else — schema, render, validation, send, writeback, menu/sidebar wiring.
- **`Engine` lock:** the sheet itself is not split. `MAX_SENDS`-per-run and email gap/cadence timing are library-level defaults, enforced in code as operator-only — no menu path exposes them to a BDM.
- **Versioning:** pinned per BDM, not automatic. Each container script references an explicit library version. A fourth spreadsheet, the operator's own test sheet, tracks head and never sends real outreach.
- **Current fleet:** David (live, migrating), Muki (in build), Mike (onboarding paused indefinitely — no current use case).

Full context: [[Vale_Extension_Handover]]


---

# Appendix

## Emoji List


> [!bug] Emoji Encoding
> Gmail's plain-text send path (which the MVP currently uses via `GmailApp.sendEmail()`) doesn't preserve Unicode properly for all emoji ranges. Some emoji encode fine; others either don't have stable support across email clients or require UTF-8 handling that plain-text sends botch.

- 🚩
- 📅