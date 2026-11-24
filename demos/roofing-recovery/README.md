# Lead Recovery Desk: roofing sales demonstration

A self-contained sales demo for a **managed lead-recovery service** for independent US roofing
contractors: *"We help roofing contractors recover revenue from leads and estimates that would
otherwise be forgotten."*

It is a market-validation demo, not a product. All data is fictional. Nothing is ever sent.

> This folder is separate from the English-learning app in the repository root. It reuses the
> root's installed dependencies (React, TypeScript, Tailwind 4, Vite, Vitest). It does not change
> any root file, and the root build, typecheck and tests do not include it.

## Run it

From the repository root:

```bash
npm ci                                                   # once
npx vite --config demos/roofing-recovery/vite.config.ts  # dev server → http://localhost:5173
```

Other commands (from the repository root):

```bash
npx tsc -p demos/roofing-recovery                                 # typecheck
npx vitest run --config demos/roofing-recovery/vite.config.ts     # tests
npx vite build --config demos/roofing-recovery/vite.config.ts     # static build → demos/roofing-recovery/dist
```

## Two-minute demo script

1. **Dashboard**: "11 leads worth $127,950 are waiting on a follow-up. 5 are high priority."
2. **Review high-priority leads** opens the pipeline filtered to High.
3. Open **James Whitfield**: a $22,750 estimate, 20 days old, never followed up.
4. **Why this lead was flagged** lists each rule and its points.
5. Edit the suggested message.
6. **Approve draft**.
7. **Mark follow-up completed**.
8. Go back to the Dashboard or Reporting: *Need follow-up* 11→10, *High priority* 5→4, *Follow-ups completed* 3→4.

Use **Reset demo data** in the footer to start again.

## How it works

| Path | Purpose |
| --- | --- |
| `src/logic/priority.ts` | Rule-based priority and eligibility (High / Medium / Low / No action required) |
| `src/logic/workflow.ts` | Validated follow-up transitions: approve, revise, complete, dismiss, restore, record result |
| `src/logic/drafts.ts` | Personalised message drafts (unanswered inquiry, unsold estimate, unanswered reply, stalled conversation) |
| `src/logic/metrics.ts` | The one place where every dashboard and report figure is computed |
| `src/logic/csv.ts` | Optional CSV import. Validates the whole file and imports nothing if any row is invalid |
| `src/logic/storage.ts` | Saves to `localStorage` and falls back to the sample data if saved data is malformed |
| `src/data/seedLeads.ts` | 19 fictional Central Texas leads |
| `src/ui/` | React views: Dashboard, Pipeline, LeadDetail, Reporting |

The app keeps one state: the list of leads. Priority, recommendations and every metric are derived
from that list, so all screens stay consistent.

**Priority rules** (evaluated against a fixed "as of" date, Nov 20 2026, so the demo is deterministic):

1. Booked, closed-lost and opted-out leads are never recommended for contact. Neither are leads
   already handled (completed, dismissed, replied or appointment booked).
2. An unanswered customer reply is always High.
3. No follow-up within 3 days of the last contact, and none after 4 unanswered follow-ups.
4. Otherwise points are added for:
   - job value (0 to +3)
   - situation (unanswered inquiry +3, estimate with no decision +2, stalled conversation +1)
   - time since the last contact (+1 or +2)
   - no follow-up made since the estimate (+1)
   - three or more previous follow-ups (−1)

   A score of 6 or more is High, 4–5 is Medium, and below 4 is Low.

These rules rank what to review first. They do not predict conversion.

## Known limitations

- The date is fixed (Nov 20, 2026), so lead ages do not move in real time.
- Each lead has one follow-up cycle. After completion it is not re-recommended in this demo.
- Replies and appointments are recorded by hand on a completed lead to illustrate results.
- Data is saved only in the browser's `localStorage`, per browser.
- There are no UI component tests. The business logic is unit-tested, and the main journey was
  checked manually in a headless browser.

## Before handling real contractor data

This demo would need, at minimum:

- authentication and per-contractor data isolation
- a real backend with encrypted storage, plus retention and deletion policies
- consent and opt-out handling that meets TCPA, CAN-SPAM and state rules, with quiet hours and suppression lists
- audit logs of who approved and sent each message
- real CRM, email and SMS integrations with delivery tracking
- a live clock and time zones
- deduplication
- a privacy policy and data-processing agreement
- security review
