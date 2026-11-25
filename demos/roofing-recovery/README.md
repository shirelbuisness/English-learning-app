# Lead Recovery Workbench (internal prototype)

This is an internal operator tool for delivering a managed unsold-estimate recovery service to independent roofing contractors. It is sized for one operator and a first paid pilot of about 25–40 estimates.

It is **not** a contractor portal, a CRM, a SaaS product or an outreach engine. **It never sends anything.** Emails and calls happen outside the tool. The operator then records here, with an explicit confirmation, what actually happened.

> **Status: synthetic data only.** This prototype is not approved for real contractor or homeowner data. See [Before real data](#before-real-data-can-be-used).

This folder is self-contained. It reuses the repository's installed packages (React, TypeScript, Tailwind 4, Vite, Vitest) and adds no new ones. The English-learning app in the repository root is not affected, and its build, typecheck and tests do not include this folder.

## Run it

From the repository root:

```bash
npm ci                                                        # once
npx vite --config demos/roofing-recovery/vite.config.ts       # → http://localhost:5173
npx tsc -p demos/roofing-recovery                             # typecheck
npx vitest run --config demos/roofing-recovery/vite.config.ts # tests
npx vite build --config demos/roofing-recovery/vite.config.ts # static build → demos/roofing-recovery/dist
```

The app opens on a populated synthetic demonstration pilot. Its dates are relative to today, so lead ages and due dates look realistic.

## Daily workflow

1. **Contractors & pilots.** Create the contractor, then a pilot with:
   - dates and the agreed record limit;
   - approved channels;
   - the approved communication policy and templates;
   - the Day 1 / 4 / 9 sequence guidance.

   Activate the pilot once the policy is recorded.
2. **Import.** Download the template and upload a CSV. You then see a row-by-row preview with:
   - normalised email and phone, and validation errors and warnings;
   - duplicate, conflict and in-file-duplicate detection;
   - suppression-ledger matches.

   Choose import, exclude, skip or update for each row, then commit.
3. **Queue.** One prioritised list, in working order:
   1. records requiring review;
   2. drafts and contractor approvals;
   3. approved follow-ups that are due;
   4. homeowner replies;
   5. warm handoffs.

   Filters: contractor, pilot, priority, follow-up date and group.
4. **Record page.** Everything about one estimate:
   - eligibility evidence and decisions;
   - exclusion, suppression and restriction review;
   - the draft editor;
   - recording contractor approval;
   - confirmed contact with its outcome;
   - qualification of a reply, and the handoff (created → notified → acknowledged → outcome);
   - full history.
5. **Batch approval** in the queue. Select drafts and either mark them sent to the contractor or record the contractor's approval. Each draft is revalidated on its own, and blocked ones are listed with the reason.
6. **Report.** Data quality, activity, the outcome ladder, results by estimate-age band, time tracking, expenses and economics, plus CSV exports.
7. **Data.** Pilot export (JSON), clearing a pilot, resetting the demo, the suppression ledger and the activity log.

## Key rules

The rules are enforced in `src/domain/`, not in the UI. Every action path calls the same checks.

### Eligibility

Every record has one of these states:
- pending review;
- eligible (subject to documented authorization);
- ineligible;
- excluded by contractor;
- suppressed / do not contact.

New records start as pending review, unless the import marks them as suppressed, excluded or sold/lost. Marking a record eligible requires all of the following:
- the estimate is open;
- there is a usable contact detail;
- there is no prior opt-out;
- authorization evidence is recorded;
- at least one channel is pilot-approved, has documented `yes` consent and has a contact detail for it;
- the contact is not on the ledger.

Missing or unclear consent is treated as `unknown`, which never counts as permission.

### Precedence

Suppression and exclusion override every workflow state:
- Applying either one immediately blocks every open draft, submitted draft and approved draft. Withdrawing a channel from the pilot blocks drafts on that channel. Changing contact details or evidence sends an eligible record back to review.
- `contactBlockers()` is rerun right before every submission, approval and contact confirmation, including inside batch approval.
- Lifting a suppression or exclusion is a separate review action that needs a reason. It is audited and returns the record to *pending review*, never straight to eligible. Previously blocked drafts stay blocked.
- If the same contact is also on the ledger from another record or a cleared pilot, the record-level review is refused until that ledger entry is reviewed (Data page).
- A suppressed or excluded record cannot have a reply qualified, a handoff created or the contractor notified. A handoff the contractor was already told about can still be acknowledged and closed out.
- A message approved before the record changed (for example, an updated estimate from a re-import) cannot be recorded as contacted. It shows in the queue as "Revise draft". Revising revokes the approval, which is audited, and the message must be approved again.

### Suppression ledger

The ledger is scoped to the contractor and stored separately from pilot records:
- Opt-outs (recorded during outreach, entered manually, or reported in an import) add the contact's normalised email and phone to it, and immediately suppress the same contact (matched on email or phone) in every other pilot of that contractor.
- Imports check it. A matching contact is imported as suppressed.
- Clearing a pilot keeps it, so a re-import cannot re-enable a suppressed contact.
- Another contractor's ledger does not apply. How long entries are kept is **not** decided; see below.
- An entry can be lifted on the Data page with a reason of at least 10 characters. This is audited and does not un-suppress any record; each record needs its own review.

### Deduplication

Deduplication is deterministic and works within one pilot only:
- Matches are exact on normalised email or normalised phone. There is no name or address matching.
- If the email and phone match different records, the row is a conflict and can only be skipped.
- For a duplicate, the operator sees the fields that differ:
  - "Update" applies only estimate details (amount, status, service, city/state, last contact, follow-up count), and only from columns the file actually contains with a non-blank value. A partial file never blanks existing data.
  - A status change to sold or lost makes an eligible record ineligible. A change to unknown sends it back to review.
  - Restrictions in the file (opt-out, exclusion, sold/lost) can only tighten a record.
  - History, eligibility, authorization evidence and workflow state are never reset.
- Re-importing unchanged data changes nothing.

### Workflow states

Each message goes through these stages:
- draft → awaiting contractor approval → approved → manually contacted (with an outcome);
- or blocked / cancelled.

"Approved" means authorized; it never counts as outreach. Recording a contact requires:
- an explicit "this actually took place" confirmation;
- a date that is not in the future and not before the approval;
- the approved channel.

Outcome effects:
- Opted out → suppressed and added to the ledger.
- Not interested → closed.
- Incorrect contact → ineligible.
- Positive replies wait for review.

A reply becomes a **qualified re-engagement** only when it is a positive reply (interested, callback, inspection or revised estimate) and the operator confirms that the homeowner said the project is unresolved and asked for a next step. An "Other" reply must first be reclassified (audited) or the record closed. This keeps the outcome ladder nested: replies ⊇ positive ⊇ qualified ⊇ handoffs ⊇ acknowledged ⊇ appointments ⊇ jobs won. A handoff needs that qualification. A won job needs the contractor's confirmation.

### Prioritisation

Prioritisation uses transparent points that are shown on each record:
- estimate amount;
- age (14–30 / 31–60 days);
- the contractor's previous follow-ups.

Records under 14 days old, or contacted by the contractor in the last 7 days, are "No action" until our sequence starts. Records older than 60 days are capped at Low. A record that needs review is shown as "Requires review". The **14–60 day window is a hypothesis**, and the age at import is kept on each record so the report can compare age bands. Nothing predicts conversion.

## Code layout

| Path | Responsibility |
| --- | --- |
| `src/domain/types.ts` | Entities. A contractor holds business details and owns the ledger. A pilot holds terms, channels, policy, sequence and economics inputs. A record belongs to one pilot. |
| `src/domain/state.ts` | `transact()`: each command runs on a copy and either commits every change (with its audit events) or none |
| `src/domain/importer.ts` | CSV template, preview/validation, normalisation, dedupe, commit |
| `src/domain/eligibility.ts` | Eligibility blockers, permitted channels, contact blockers, ledger lookup |
| `src/domain/records.ts` | Every record command (eligibility, suppression, drafts, approvals, outreach, replies, handoffs) |
| `src/domain/priority.ts`, `queue.ts` | Prioritisation rules; the action queue and workflow status |
| `src/domain/report.ts` | **All** pilot metrics and economics (single source for screens and exports) |
| `src/domain/economics.ts` | Time entries, expenses, hourly-cost assumption, revenue |
| `src/domain/lifecycle.ts` | Clear pilot, strip demo data, JSON/CSV exports |
| `src/domain/templates.ts` | Local, rule-based message drafts (no AI service) |
| `src/storage/localStore.ts` | Persistence boundary (`load`/`save`). Today: browser `localStorage`, one JSON write per command. Stored data is shape-checked on load; unreadable data is backed up, not discarded, and not overwritten at start-up. The id counter is repaired if it lags behind existing ids. A revision number stops a stale browser tab from overwriting newer changes made in another tab. |
| `src/data/demoSeed.ts` | Synthetic demo, built by running the real commands in date order |
| `src/ui/` | React screens; display and input only |

The activity log is append-only within the application: no command edits or removes earlier events, except clearing a pilot, which deletes that pilot's events and keeps a summary event, and resetting the demo. It is **not** tamper-proof: anyone with access to the browser profile can edit browser storage. Each event has the record, pilot and contractor ids, the event type, a timestamp, the from/to state and a detail. The current state is kept as ordinary records; this is not event sourcing.

### Export format

**Data → Export pilot data** downloads `<pilot>-export-<date>.json` with these fields:

```text
format: "roofing-recovery-pilot-export", formatVersion: 1, exportedAt, syntheticDataOnly: true,
contractor, pilot, records[] (incl. original import row, eligibility, touches/contact history,
qualification, handoff), imports[], timeEntries[], expenses[], events[] (audit log),
suppressionLedger[] (the contractor's), report (all computed metrics)
```

The Report page also exports CSVs of the report, the records, the activity log and the time entries. Exported cells that start with `= + - @` are prefixed with `'` to neutralise spreadsheet formulas.

### Data lifecycle

The three operations are separate. None of them affects the others.

- **Reset demo data** removes and rebuilds only demo contractors and everything under them. Pilots created under a demo contractor count as demo data.
- **Export pilot data** exports one selected pilot.
- **Clear pilot data** deletes one selected pilot: its records, contacts, handoffs, imports, time, expenses and history. It shows exactly what will be deleted first and requires a checkbox plus the typed pilot name. A summary deletion event is kept, and so is the contractor's suppression ledger.

## Known limitations

- **Storage.** It is browser `localStorage`: one browser profile, not encrypted, no backup, no multi-device sync, and roughly a 5 MB limit (enough for several pilots of this size).
- **Single operator.** There are no user accounts, so the activity log does not record *who* acted.
- **Two tabs.** A stale tab cannot overwrite newer changes: its save is refused and the latest data is reloaded. The check is not a lock; two tabs saving in the same instant are not fully excluded.
- **Clock.** Dates use the operator's local calendar day. Contractor time zones are stored but not yet used for scheduling.
- **No automation.** There is no scheduling, reminders, email or SMS sending, calendar, or CRM sync; by design for this stage.
- **Templates.** There are three email templates plus a call script. Policy text is free text, not per-pilot editable templates.
- **Closed records.** A record closed for wrong contact details, "not interested" or a non-qualified reply cannot be reopened in the UI.
- **Duplicates.** Duplicate "update" never changes the name, email, phone or authorization. Those are edited manually on the record after review.
- **Opt-out count.** The report counts opt-outs recorded during the pilot. Opt-outs carried in by an import are counted under "Suppressed".

## Deliberately deferred

Backend and database, authentication, multi-user roles, any outbound integration (email, SMS, telephony, CRM), contractor-facing views, AI drafting, automatic scheduling, payment handling, and statistical analysis of age bands.

## Before real data can be used

The rules in this tool record evidence and enforce operator decisions. They are **not** proof of legal compliance. Before any real contractor or homeowner data is used, at least the following must be reviewed and put in place.

### Security and operations

- **Device-level encryption** (FileVault/BitLocker) and strong device authentication on every machine that runs the tool. Better still, move storage to an encrypted, access-controlled backend; the persistence boundary is in `src/storage/` for that purpose.
- **Access restrictions.** Named operator accounts, so the audit log records who acted, plus least-privilege access to exports.
- **Backup and recovery.** Browser storage can be wiped by the user or the browser.
- **Auditability.** Tamper-evident logs. Today the log is editable by anyone with browser access.
- **Secure deployment.** Hosting, dependency updates, an incident response plan, and handling of exported files: today they are unencrypted downloads.

### Legal and privacy questions for qualified review

- **Data retention and deletion.** How long pilot records and the suppression ledger are kept. Ledger retention is deliberately unresolved.
- **Data sharing.** A data-processing agreement with each contractor, covering roles (controller/processor), data sharing, and the rights of homeowners whose data is processed.
- **Cross-border handling.** Rules for any processing or access from outside the US.
- **Communication rules.** Which rules apply to each channel and message type, for example:
  - TCPA consent requirements for calls and texts, including prior express written consent;
  - the National and state Do-Not-Call lists, and Texas and other state telemarketing rules;
  - CAN-SPAM content and opt-out requirements for email;
  - quiet hours.

  Also: whether contractor-collected consent covers messages sent by a service provider on the contractor's behalf, and what counts as adequate authorization evidence.
- **Opt-out scope.** Whether a homeowner's opt-out to one contractor should also apply across that contractor's other channels and brands.
