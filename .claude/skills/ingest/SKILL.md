---
name: ingest
description: Ingest a WhatsApp-copied list of Satyanarayana Vratam sankalpa entries (a .txt file path) into the live Members sheet for the current month. New families become One-Time for this month; families repeating from last month are converted to Annual starting from the earliest month they appeared. Use when the user runs /ingest <path> or asks to import/load a WhatsApp list.
argument-hint: <path-to-whatsapp-text-file>
allowed-tools: Read, Write, Bash(node .claude/skills/ingest/vratam.mjs *)
---

# /ingest — load a WhatsApp list into the Vratam app

Input: `$ARGUMENTS` — path to a UTF-8 text file copied from the WhatsApp group
(Telugu sankalpa entries, numbered, possibly with `[10:00 AM, 9/24/2026] +91 …:` prefixes).

The helper `.claude/skills/ingest/vratam.mjs` talks to the deployed Apps Script
(`API_URL` from `index.html`, PIN from `$VRATAM_PIN` or `ACCESS_PIN` in `Code.gs`).
It writes JSON to files — always read those with the Read tool, never rely on
console output for Telugu text. Put working files in the scratchpad directory.

## Rules

- **Target month (T)** = the current calendar month (today's date), as `YYYY-MM-01`.
  Everything in the file is treated as a request for T.
- **Previous month (P)** = the month before T.
- A member "covers" T when `status === 'Active'` and `startMonth <= T <= endMonth`.

Classify each entry after matching it to existing members:

| Case | Condition | Action |
|---|---|---|
| **Already covered** | Matches an Active member that already covers T (an Annual running through T, or a One-Time for T) | No new row. If the entry text adds/changes names, `update` its `fullText` only. |
| **Repeat → Annual** | Matches an Active One-Time member whose month is P | `update` that member to `membershipType: 'Annual'`, `startMonth` = **earliest month of the consecutive run** of One-Time appearances ending at P (walk back P, P-1, … while a matching One-Time row exists for each month). Keep the existing ID. Update `fullText` to the new text if it differs. End month is computed by the server (start + 11). |
| **New** | No match | `add` with `membershipType: 'One-Time'`, `startMonth: T`. |
| **Ask** | Matches only an older One-Time (gap before P), an expired Annual, a Cancelled member, several plausible members, or a weak/uncertain match | Do not guess — list these for the user to decide. |

When the run found for a repeat has more than one row (e.g. a July and an August
One-Time for the same family), convert the **earliest** row to Annual and list the
later duplicate rows under "Ask" so the user can cancel them.

Never create a separate Annual row for a repeat — the existing row is converted so
its ID, token (private link) and completion history are preserved.

## Steps

1. **Parse.** `node .claude/skills/ingest/vratam.mjs parse "<path>" <scratch>/entries.json`
   then Read it. Each entry has `num`, `raw` (lines) and `joined` (one line). Check the
   split: an entry with `num: null` is text before the first number — merge or drop it.
   A single WhatsApp message can hold several numbered entries; the parser already splits those.

2. **Normalize each entry** into:
   - `gotram` — the gotram word without `గోత్రం`/`గోత్రము` (e.g. `హరితస`, `విశ్వామిత్ర`, `రాపిల్ల`).
     Entries can mention it anywhere ("… , గౌతమస గోత్రం..సంగారెడ్డి", "గోత్రం : రా పిల్ల", "గోత్రము - ఆత్రేయస").
     If an entry has multiple families with different gotrams, use the first gotram.
   - `fullText` — one line in the house style used by existing rows:
     `<gotram> గోత్రం <names…>`; separate extra gotram groups with `; ` like
     `కాశ్యపస గోత్రం … ; ఆత్రేయస గోత్రం …`. Drop WhatsApp noise (timestamps, phone numbers,
     stray `..`, trailing `.`), keep the names as written (don't "correct" spellings).
   - `headName` — leave empty unless the user asks; existing rows mostly leave it blank.

3. **Fetch members.** `node .claude/skills/ingest/vratam.mjs members <scratch>/members.json`
   and Read it (all statuses are included).

4. **Match** each entry against members. Matching is a judgment call on Telugu text:
   same/compatible gotram (ignore spacing: `రా పిల్ల` = `రాపిల్ల`) **and** the same head
   person (surname + first name of the first named person, allowing spelling variants like
   `మొలుగు`/`ములుగు`, `దాతారు`/`దాతరు`, `G.V.`/`జి.వి.`). A shared surname alone is not a match —
   families like `నందగిరి` or `గాడిచర్ల` have several distinct members. Also check for
   duplicates *within* the file.

5. **Show the plan** to the user before writing anything, grouped as:
   - A. Repeat → Annual (`[id]`, start month, new text if changed)
   - B. New → One-Time for T
   - C. Already covered (and whether text will be updated)
   - D. Needs your decision (with the reason and candidate IDs)

   Also write the same plan as a human-readable report to
   `resources/data-<YYYY-MM>-ingest-<YYYY-MM-DD>.txt` (see `resources/data-2026-09.txt` for the style).
   Wait for the user's confirmation / answers on group D.

6. **Apply.** Write `<scratch>/plan.json` — an array of ops:
   ```json
   [
     { "op": "update", "id": 34, "membershipType": "Annual", "startMonth": "2026-08-01", "fullText": "…", "note": "repeat from 2026-08" },
     { "op": "add", "gotram": "కౌండిన్యస", "fullText": "…", "membershipType": "One-Time", "startMonth": "2026-09-01", "note": "#49 new" }
   ]
   ```
   Only include fields you intend to change on `update` (omitted fields are preserved).
   Run `node .claude/skills/ingest/vratam.mjs apply <scratch>/plan.json <scratch>/results.json`.
   Ops are not transactional — if some fail, report which and re-run only those.

7. **Verify.** Re-fetch members and confirm every entry in the file now covers T
   (converted rows show Annual with the expected start/end). Report counts per group,
   the new IDs assigned, and any failures.

8. **Sync past months.** Every month before T counts as done, even if nobody pressed
   "Mark Complete" at the time (the app's history screens already show it that way).
   Run `node .claude/skills/ingest/vratam.mjs sync <scratch>/sync.json --dry`, report the count,
   then run it again without `--dry` to write the missing completions. Cancelled members are skipped.
