# CLAUDE.md — Estimate Recovery Workbench

## What this is

A **human-in-the-loop Estimate Recovery Service** for independent residential roofing contractors, run by a solo operator.

- The contractor hands over ~25 stale quotes: unsold, 14–60 days old, $8k+.
- The operator drafts short, personal follow-ups.
- The contractor approves them by replying "Approved" to a text or email.
- The approved messages go out **from the contractor's own inbox or business number**.
- Homeowners who want to talk are handed back to the contractor as warm leads.

This repository is the operator's internal workbench (React + TypeScript + Vite, browser-only). It is **not** a contractor dashboard, CRM, auto-dialer or bulk sender, and it never sends anything.

## Service rules (binding: code, copy and advice must respect these)

1. **Never send without contractor approval.** Every message is approved by the contractor before it goes out. Approval is recorded in the workbench and revalidated at that moment (eligibility, opt-out, exclusion, channel, unchanged record).
2. **Approved ≠ sent.** A contact counts only when the operator confirms it actually happened, with its date.
3. **Respect opt-outs immediately.** Any "stop", "not interested in being contacted" or similar ends all outreach to that homeowner at once, across every pilot for that contractor, and a re-import can't undo it. Lifting a suppression needs a written reason and a review.
4. **Respect contractor exclusions** (neighbours, disputes, VIPs) the same way.
5. **Keep raw homeowner PII in the contractor's system whenever possible.**
   - Use **privacy-safe pilots**: store only estimate ID, first name, roof scope, quote amount, age/date and notes.
   - No phone numbers, emails, surnames or street addresses in this tool.
   - Imports drop those columns automatically in privacy-safe pilots.
6. **Contact permission** in a privacy-safe pilot rests on the contractor's written attestation, recorded on the pilot with a date. An explicit per-homeowner "no" still wins. This is a business judgement, not legal advice; texting in particular needs legal review.
7. **No pressure tactics.** No false urgency, no "limited time", no discounts the contractor hasn't approved, no claims about insurance outcomes.
8. **Report honestly.** Keep replies, positive replies, qualified re-engagements, handoffs, contractor acknowledgements, appointments and contractor-confirmed wins separate. Never call potential value "recovered revenue". Sample data is always labelled fictional.

## AI drafting prompts (used manually, outside the app)

**Privacy rule for AI tools:** give the model only `first_name`, `roof_scope`, `quote_amount`, `days_since_sent`, `notes`, `contractor_business`, `sender_first_name` and `channel`. Never surnames, phone numbers, emails, addresses, claim numbers or insurer names. Paste the output into the workbench draft, review it, then send it for approval as usual.

### Master prompt

```
You are writing a short follow-up from a local roofing contractor to a homeowner who
received an estimate a few weeks ago and hasn't decided yet.

Facts (use only these, invent nothing):
- Homeowner first name: {first_name}
- Roof scope: {roof_scope}
- Quote: {quote_amount}, sent {days_since_sent} days ago
- Contractor's note: {notes}
- From: {sender_first_name} at {contractor_business}
- Channel: {channel}   (sms or email)

Write like a real person at a small family roofing company: warm, plain, brief.
- One friendly line of context, one helpful offer, one easy question.
- Make it easy to say "not now" or "we went another way".
- No pressure: no deadlines, "limited time", discounts, scare tactics or exclamation-heavy hype.
- Don't promise anything about insurance outcomes, prices or schedules.
- SMS: max 300 characters including the sign-off, and end with "Reply STOP to opt out."
- Email: max 120 words, a short subject line, sign with {sender_first_name} and {contractor_business}.

Return only the message (and subject line for email).
```

### Situation add-ons (append the one that matches the contractor's note)

**Insurance / storm delays** (note mentions adjuster, claim, hail, wind, storm, deductible):
```
The homeowner is waiting on insurance. Acknowledge that claims take time, ask if the adjuster
has been out yet, and offer to help with paperwork or meet the adjuster on site. If the note
says the claim was approved, congratulate them briefly and offer to get them on the schedule.
Never state what insurance will or won't cover.
```

**Seasonal scheduling** (no specific note, or note mentions timing, holidays, "later", "spring"):
```
Mention, without pressure, that the schedule for the coming weeks is filling up, and offer to
pencil them in or check back at a time that suits them. If they said "after the holidays" or a
season, acknowledge it and ask whether that timing still works.
```

**Budget / financing check-in** (note mentions budget, price, financing, payments, "too high"):
```
Acknowledge that a roof is a big expense. Offer to revisit the scope (e.g. options, phasing)
or explain financing options if the contractor offers them. Don't quote rates or terms.
Ask whether it would help to talk it through.
```

Also usable:
- **Comparing bids** ("2nd bid", "other quotes"): offer to walk through the bid line by line so they compare like for like (materials, underlayment, ventilation, warranty).
- **Couple deciding** ("husband/wife", "talking it over"): offer a quick call or visit when both are home.

## Engineering guide

```bash
npm ci            # install from the committed lockfile
npm run dev       # local app
npm test          # vitest (domain tests)
npm run typecheck
npm run build
```

- `src/domain/` holds pure TypeScript business rules. **All rules are enforced here**, never only in the UI. Every command runs through `transact()`: a command either applies all its changes plus their audit events, or none.
- `src/storage/` is the only place that touches browser storage. It validates shape, migrates older saves and checks revisions so a stale tab can't overwrite newer data.
- `src/data/` holds the sample pipeline and the extended demo, built by running real domain commands.
- `src/ui/` is React, display and input only.
- Add a focused test for every rule or bug fix. Never weaken a test to make it pass.
- No backend, no outbound sending, no CRM/email/SMS integration and no AI API calls in the app, unless the owner explicitly decides otherwise.
- No real homeowner data in the repository, test fixtures or screenshots. Use example.com emails and 555-01xx numbers in samples.
- Report test, build and browser results only after running them, verbatim if they fail.
