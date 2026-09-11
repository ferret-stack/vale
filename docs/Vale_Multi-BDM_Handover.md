# Vale — Multi-BDM Rollout Handover (v2)

Point any fresh Claude chat in this project at this document to start the build. Supersedes the earlier handover; written after the Sept 11 desk-session Rattle where Theme A was fully closed and Theme B was unblocked.

## Context

Vale is the Google Sheets + Apps Script cold outreach automation system, originally built for David (BDM), prospecting estate agents. Current effort: extending it so Muki and Mike can also use it, without forking the codebase three ways. **Muki's build is the immediate task this document exists to support.**

Source material for detail beyond this summary:
- `11_Sept_Multi-BDM_Rattle` — the original unstructured dump for this Rattle
- `BDM_Extension_Themed_Findings.md` — the themed write-up (Theme A/B/C) that preceded today's resolution
- `9_Sept__sys.shutdown____for_Vale` — where the one-spreadsheet-per-BDM / library architecture idea originates
- `template_Prospecting.xlsx` — David's actual working sheet; real column shape
- `README`, `Dev_Log_2026-27.md`, `MVP_Build_Spec_v3.md`, `Phase2_Prompt_v3.md` — original MVP build context
- `00_Schema.gs` through `11_Import.gs`, `Sidebar.html`, `SendPreview.html` — David's current live code, the extraction source for the library

## Architecture — CLOSED (Theme A)

All of Theme A is now decided. Nothing here is provisional.

**Structure:**
- One spreadsheet per BDM — not a shared sheet. Avoids lock contention and queue clutter across concurrent users.
- Shared logic lives in one bound, published, versioned Apps Script library: schema definitions, the render engine, validation, send logic, writeback, and menu/sidebar wiring.
- Each BDM's spreadsheet runs a thin container script that calls into the library. BDM-specific nuance (e.g. something Mike needs that David/Muki don't) lives as local logic in that BDM's own container script — it is never a library fork.

**Local-vs-library split (finalised):**
- **Stays local per BDM:** Prospects, Send Queue, Templates, Engine config rows that are genuinely personal (sender name, test email, signature), and seed data.
- **Moves to the library:** schema, render engine, validation, send logic, writeback, menu/sidebar wiring — i.e. everything that is behavior rather than per-BDM data/identity.

**Engine sheet — locking mechanism (decided, this session):**
- Engine stays as **one sheet**, not physically split. The boundary is enforced in code, not layout.
- Operational tuning values — **max sends per run** and **email gap/cadence timing** — are **library-level defaults, operator-owned**. BDMs cannot edit these: the container script either rejects writes to these keys or simply doesn't expose them through any menu action a BDM has access to. Wesley owns changes; BDMs message him if a change is needed.
- Genuinely per-BDM Engine rows (sender name, test email, signature) remain BDM-editable as before.
- This follows the same pattern already in use for the `PROSPECT_WRITABLE` allowlist on Prospects — structural enforcement, not convention.
- Rationale: the cell-protection/header-validation guardrail is still parked (see below), so locking Engine in code sidesteps needing that guardrail built before Muki ships.

**New addition — test-mode CC (decided, this session):**
- On the **test send path only**, Wesley's email should be added as a CC alongside the test inbox recipient. Does not apply to live sends. Wire this in wherever the test send fires, not in the general send path.

**Versioning discipline (decided, this session):**
- **Pinned, not automatic.** Each BDM's container script points at an explicit library version number. Wesley bumps a given BDM's pin deliberately when a change is confirmed good — no auto-propagation of library changes to live sheets.
- Per-BDM nuance is handled via local container logic (see Structure above), so pinning doesn't create three divergent library forks — the library itself stays a single line of versions.
- **There are four spreadsheets in the fleet, not three:** David, Muki, Mike, plus **Wesley's own Vale test sheet**, which is the build/break environment. The test sheet points at the newest library version (effectively head) and sends no real outreach. Confirmed-good changes get promoted from there to individual BDM pins.

**Still deliberately parked (not blocking, not designed):**
- Guardrails against BDMs breaking cells/headers directly (protected ranges, pre-run header validation) — future scope.

## Rollout state — Theme B (largely resolved)

- **Muki is unblocked and ready to build now.** Her use case matches David's exactly (estate-agent prospecting), her template is already in hand, and the library architecture above is generic across use cases — building her now is a second proof of the architecture, not a guess that risks rework.
- **Mike is not blocking Muki.** A text has been sent asking him for his current outreach tracking template/spreadsheet (columns and all), same as Muki's is already on file. Whatever his workflow turns out to need becomes local logic in his own container script when it arrives — it will not touch Muki's sheet or her library pin.
- Sequencing stands as originally decided: Muki's build first, Mike's build once his template lands.
- The schema-compatibility assumption (David/Muki's agent schema also fits Mike's client outreach) is still formally unverified against Mike's real data — **spinach flag carried forward** — but this no longer gates Muki's build.

## Other open threads (adjacent, not part of today's build)

- **Theme C — email copy quality/philosophy:** shared prompt/project idea for BDMs to generate their own copy, unscoped. David's current copy flagged as poor, root cause diagnosed as pasting raw LLM output uncritically. Flagged for a board discussion; target document not yet named. No movement this session, not urgent for the build.
- **David's import/column-map mismatch:** `IMPORT_COLUMN_MAP` doesn't match his actual header row in `template_Prospecting.xlsx`. Predates this Rattle, still unresolved, not folded into Theme A/B.

## Build sequence for the next session

1. Extract shared logic out of David's current `.gs` files into a proper Apps Script library project (schema, render, validation, send, writeback, menu/sidebar wiring).
2. Confirm David's sheet still works correctly pointed at the library (regression check before anything else is built on top).
3. Enforce the Engine lock in code: reject or hide BDM access to max-sends and gap-timing keys; leave sender name/test email/signature editable.
4. Wire the test-mode-only CC addition into the test send path.
5. Build Muki's thin container script against the library, using her existing template.
6. Set up the fourth spreadsheet — Wesley's own Vale test sheet — pointed at head, for future build/break work.
7. Confirm Muki's sheet end-to-end (import → staging → send queue → test send with CC → writeback), pinned to a specific library version once confirmed good.

## Next concrete action

Green light this build in a working session (code-heavy, not voice). Bring this document plus David's live `.gs`/`.html` files. Once Muki's build is confirmed working, request the session shutdown to log the outcome.
