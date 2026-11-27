# Estimate Recovery Workbench

The operator workbench behind a **done-for-you Estimate Recovery Service** for residential roofers. The contractor hands over 25 stale quotes. I draft personal, low-pressure follow-ups. The contractor approves them with a one-word text. The approved messages go out from the contractor's own inbox or phone. I hand back homeowners who want to talk.

It is **not** a contractor dashboard, a CRM or an outreach engine. **It never sends anything.** Messages go out from the contractor's systems. The workbench tracks the work, enforces the rules and prepares the text to paste.

> **Data status.** Use **privacy-safe pilots** for real work: they hold only an estimate ID, first name, roof scope, quote amount, age and notes. Phone numbers, emails and addresses stay in the contractor's CRM or inbox. Browser storage is still unencrypted, so read [Before real data](#before-real-data-can-be-used) before the first paid pilot. Nothing here is legal advice.

See [`CLAUDE.md`](CLAUDE.md) for the service rules and the AI drafting prompts.

## Run it

Needs Node.js 20.19 or later.

```bash
npm ci          # once, installs from the committed lockfile
npm run dev     # → http://localhost:5173
npm test        # unit tests
npm run build   # typecheck + production build → dist/
```

The app opens on a **sample roofing pipeline**: 10 fictional estimates covering every stage. Header buttons:
- **Load sample pipeline** replaces all demo data with a fresh sample.
- **Clear / start real pilot** removes all demo data and opens setup.

Real pilots you create are never touched by either.

## Moving this folder into its own repository

This folder is self-contained: its own `package.json`, lockfile, TypeScript/Vite config, `.gitignore` and `CLAUDE.md`. It doesn't depend on anything else in the English-learning-app repository. To give it its own repository **with its history**:

```bash
# 1. In the current repository, split the folder's history onto its own branch.
cd English-learning-app
git checkout claude/beautiful-planck-w5j644
git subtree split --prefix=demos/roofing-recovery -b estimate-recovery-export

# 2. Create an EMPTY repository on GitHub (no README, licence or .gitignore), e.g.
#    github.com/<you>/estimate-recovery-workbench, then push the split branch to it.
git push git@github.com:<you>/estimate-recovery-workbench.git estimate-recovery-export:main

# 3. Clone the new repository and check that it builds and tests on its own.
cd ..
git clone git@github.com:<you>/estimate-recovery-workbench.git
cd estimate-recovery-workbench
npm ci && npm test && npm run build

# 4. Only after step 3 passes: remove the copy from the English-learning repository.
cd ../English-learning-app
git branch -D estimate-recovery-export
git rm -r demos/roofing-recovery
git commit -m "Move estimate recovery workbench to its own repository"
```

If you'd rather start the new repository without history, copy the folder (excluding `node_modules` and `dist`) and run `git init && git add . && git commit -m "Initial import"`.

## The 3-minute demo

1. **Queue:** "This is my day: one list, top to bottom."
2. **Copy approval batch:** paste it into a text to yourself and show the contractor what they'd get: numbered messages, reply "Approved". Click "Contractor replied Approved". Four drafts are approved, and the queue shows them due for sending.
3. **Sarah (Q-2231):** a real-sounding reply. Click **Copy handoff** and show the warm-lead text the contractor gets on their phone.
4. **Report → Contractor report:** what they get at the end.
5. **Linda or Tom:** opt-outs and exclusions are respected, permanently and across pilots.

[`docs/demo-script.md`](docs/demo-script.md) has the talk track and objection answers. [`docs/pilot-one-pager.md`](docs/pilot-one-pager.md) and [`docs/pilot-agreement-summary.md`](docs/pilot-agreement-summary.md) are the offer documents.

## Daily workflow (real pilot)

1. **Contractors & pilots:** create the contractor and a pilot. Choose **privacy-safe** (recommended), and record what the contractor confirmed about contact permission (the *attestation*). The pilot can't be activated without it.
2. **Import:** load the contractor's quote export (CSV), or a sheet you typed from their CRM. The minimum is `Estimate ID, First Name, Roof Scope, Quote Amount, Days Since Sent, Notes`; download `sample-estimates.csv` from the Import page. In a privacy-safe pilot, contact and unrecognised columns are dropped and listed, never stored.
3. **Review** each record (eligible, excluded or suppressed), then **prepare drafts**. Use the built-in templates, or the AI prompts in `CLAUDE.md`.
4. **Copy approval batch** → text or email it to the contractor → record their "Approved". Each message is re-checked when you do.
5. **Send** each approved message from the contractor's inbox or phone, then **record the contact** in the workbench (you must confirm it actually happened).
6. **Replies:** record them. For interested homeowners, **Copy handoff** and text it to the contractor. Qualify the re-engagement and track the handoff to acknowledgement and outcome.
7. **Log time** as you go; at the end send the **Contractor report** (print / PDF).

## Key rules

The rules are enforced in `src/domain/`, not in the UI. Every action path calls the same checks.

### Privacy-safe pilots (contact details stay in the contractor's system)

- A record needs only an estimate ID, first name, scope, quote amount and age (or date), plus optional notes.
- Contact permission rests on the **contractor's attestation**, recorded once per pilot with its date. An explicit per-homeowner "no" for a channel still blocks that channel. Opt-outs and exclusions work exactly as below.
- Duplicates and the suppression ledger match on the estimate ID (case- and space-insensitive) as well as on any email/phone.
- Phone, email and unrecognised columns in an import are not stored, and the record edit form refuses phone numbers and emails.
- Whether a contractor's attestation is an adequate basis for each channel, especially text messages, is a **legal question** for review; see below.

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
| `src/domain/importer.ts` | CSV templates (`sample-estimates.csv`, full template), forgiving header mapping, US/ISO dates, preview/validation, normalisation, dedupe (estimate ID, email, phone), commit |
| `src/domain/eligibility.ts` | Eligibility blockers, permitted channels, contact blockers, ledger lookup |
| `src/domain/records.ts` | Every record command (eligibility, suppression, drafts, approvals, outreach, replies, handoffs) |
| `src/domain/priority.ts`, `queue.ts` | Prioritisation rules; the action queue and workflow status |
| `src/domain/report.ts` | **All** pilot metrics and economics (single source for screens and exports) |
| `src/domain/economics.ts` | Time entries, expenses, hourly-cost assumption, revenue |
| `src/domain/lifecycle.ts` | Clear pilot, strip demo data, JSON/CSV exports |
| `src/domain/templates.ts` | Local, rule-based drafts that pick an angle from the contractor's notes (insurance, claim approved, comparing bids, couple deciding, budget, seasonal); email and SMS variants. No AI service. |
| `src/domain/touchpoints.ts` | Plain-text **approval batch** and **warm-lead handoff card** for pasting into a text/email to the contractor |
| `src/storage/localStore.ts` | Persistence boundary (`load`/`save`). Today: browser `localStorage`, one JSON write per command. Stored data is shape-checked on load; unreadable data is backed up, not discarded, and not overwritten at start-up. The id counter is repaired if it lags behind existing ids. A revision number stops a stale browser tab from overwriting newer changes made in another tab. |
| `src/data/samplePipeline.ts` | The 10-estimate sample roofing pipeline used for demos (privacy-safe, fictional) |
| `src/data/demoSeed.ts` | Extended synthetic demo (2 contractors, 35 estimates), loadable from the Data page |
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

Backend and database, authentication, multi-user roles, any outbound integration (email, SMS, telephony, CRM), contractor-facing views, built-in AI drafting (the AI prompts in `CLAUDE.md` are used manually, outside the app), automatic scheduling, payment handling, and statistical analysis of age bands.

## Before real data can be used

The rules in this tool record evidence and enforce operator decisions. They are **not** proof of legal compliance, and nothing here is legal advice.

### Minimum before the first paid privacy-safe pilot

A privacy-safe pilot keeps only estimate IDs, first names, job details and notes here. That lowers the risk; it doesn't remove it.

- Full-disk encryption and a strong login on the laptop you use; nobody else uses that browser profile.
- **Data → Export pilot data** at the end of every working session, saved somewhere encrypted. Browser storage is the only copy otherwise.
- The written pilot terms ([`docs/pilot-agreement-summary.md`](docs/pilot-agreement-summary.md)) agreed by the contractor, including the attestation and who sends messages from which number or inbox.
- **Texts are the riskiest channel.** Get a short legal review of texting homeowners on a contractor's behalf (TCPA consent, quiet hours, opt-out handling) before sending any. Until then, email-only pilots are the conservative choice.
- When drafting with an AI tool, give it only first name, scope, quote amount, age and notes, never surnames, contact details or addresses, and check the AI provider's data-use settings.

### Before storing homeowner contact details here (contact details imported here)

At least the following must be reviewed and put in place.

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
