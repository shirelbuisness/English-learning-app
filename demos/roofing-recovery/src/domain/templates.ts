import { formatShortDate, formatUsd } from './dates.ts';
import type { Channel, Contractor, EstimateRecord, TemplateKey } from './types.ts';

/*
 * Local, rule-based drafts. The operator edits them; the contractor approves them;
 * nothing here sends anything. Wording is deliberately low-pressure: one question,
 * an easy way to say "not now", and no false urgency or discounts.
 */

const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** Scope as a short, readable line item: "full replacement plus metal accent over porch". */
function scopeText(service: string): string {
  const plain = service
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*\+\s*/g, ' plus ')
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return plain ? plain.charAt(0).toLowerCase() + plain.slice(1) : '';
}

/** Business name as homeowners know it (drops internal labels like "(sample)"). */
function publicName(name: string): string {
  return name.replace(/\s*\((sample|demo)\)\s*/gi, ' ').trim();
}

export type Situation = 'claim_approved' | 'insurance' | 'comparing' | 'deciding' | 'budget' | 'seasonal';

/** Pick the follow-up angle from the contractor's notes (first match wins). */
export function situationFromNotes(notes: string): Situation {
  const n = notes.toLowerCase();
  if (/(adjuster|claim|insurance)[^.]*\b(approved|paid|came through)|\bcheck\b/.test(n)) return 'claim_approved';
  if (/adjuster|insurance|claim|hail|storm|wind|deductible/.test(n)) return 'insurance';
  if (/2nd|second|other bid|another bid|comparing|other quote|shopping|more bids/.test(n)) return 'comparing';
  if (/husband|wife|spouse|partner|decid|think(ing)? (it )?over|talk it over/.test(n)) return 'deciding';
  if (/budget|financ|payment|afford|price|cost|money|tax refund/.test(n)) return 'budget';
  return 'seasonal';
}

/** One natural sentence for the situation (email body). */
function emailAngle(s: Situation): string {
  switch (s) {
    case 'claim_approved':
      return `Glad to hear the claim came through. Whenever you're ready, we can get you on the schedule, and we're happy to help with any paperwork the insurance company needs from us.`;
    case 'insurance':
      return `I know these often stall while the insurance side gets sorted out. Has your adjuster been out yet? If it helps, we're happy to walk through the claim paperwork with you or meet the adjuster on site.`;
    case 'comparing':
      return `If you're comparing bids, I'm glad to go through ours line by line, so you're comparing like for like on materials, underlayment, ventilation and warranty.`;
    case 'deciding':
      return `Totally understand it's a big decision to make together. If it would help, we can set up a quick call or a visit when you're both home to answer any questions.`;
    case 'budget':
      return `If timing or budget is the sticking point, we can look at the scope again or go over financing options. No pressure either way.`;
    case 'seasonal':
      return `Our schedule for the next few weeks is filling up, so I wanted to check in before it does in case you'd like to get your roof on the calendar.`;
  }
}

/** One short line for the situation (SMS). */
function smsAngle(s: Situation): string {
  switch (s) {
    case 'claim_approved':
      return 'Glad the claim came through. Happy to get you on the schedule whenever you’re ready.';
    case 'insurance':
      return 'Any word from your adjuster yet? Happy to help with the claim side.';
    case 'comparing':
      return 'Happy to walk through our bid line by line if you’re comparing.';
    case 'deciding':
      return 'Happy to answer any questions for you both, whenever works.';
    case 'budget':
      return 'We can adjust the scope or go over financing if that helps.';
    case 'seasonal':
      return 'We still have a few openings on the schedule if you’d like to get it booked.';
  }
}

export function draftText(template: TemplateKey, channel: Channel, record: EstimateRecord, contractor: Contractor): string {
  const name = first(record.customerName);
  const rep = first(contractor.primaryContact);
  const biz = publicName(contractor.businessName);
  const scope = scopeText(record.service);
  const service = 'roof';
  const when = formatShortDate(record.estimateDate);
  const amount = record.estimateAmount > 0 ? ` (${formatUsd(record.estimateAmount)})` : '';
  const signOff = `${rep}\n${biz}${contractor.phone ? `\n${contractor.phone}` : ''}`;
  const situation = situationFromNotes(record.notes ?? '');

  if (channel === 'phone' || template === 'call_script') {
    return [
      `Call ${name}${record.estimateRef ? ` (${record.estimateRef})` : ''} about the roof estimate from ${when}${amount}${scope ? `: ${scope}` : ''}.`,
      `- Introduce: "${rep} asked me to check in on behalf of ${biz}."`,
      record.notes ? `- Context: ${record.notes}` : '- Ask whether the project is still open and if they have questions about the estimate.',
      `- Angle: ${smsAngle(situation)}`,
      `- If interested: note what they want next (callback, inspection, revised estimate).`,
      `- If they ask not to be contacted: record "Opted out" — no further outreach.`,
      `- Voicemail: brief, no pressure, leave ${contractor.phone || 'the office number'}.`,
    ].join('\n');
  }

  if (channel === 'sms') {
    if (template === 'final') {
      return `Hi ${name}, ${rep} from ${biz}. Last check-in on your roof estimate. If the timing's not right, no worries, just let me know and I'll close it out. Reply STOP to opt out.`;
    }
    return `Hi ${name}, ${rep} from ${biz} following up on your roof estimate. ${smsAngle(situation)} Reply STOP to opt out.`;
  }

  switch (template) {
    case 'initial':
      return (
        `Hi ${name},\n\nThis is ${rep} with ${biz}, following up on the roof estimate we sent you on ${when} (${[scope, record.estimateAmount > 0 ? formatUsd(record.estimateAmount) : ''].filter(Boolean).join(', ') || 'roof work'}). ` +
        `${emailAngle(situation)}\n\n` +
        `If you've already gone another direction, just let me know and I'll close out your file.\n\n${signOff}`
      );
    case 'unanswered':
      return (
        `Hi ${name},\n\nJust a quick follow-up on your ${service} estimate. ${emailAngle(situation)} ` +
        `Reply here with a good time and we'll work around you.\n\n${signOff}`
      );
    case 'final':
      return (
        `Hi ${name},\n\nI don't want to keep filling your inbox, so this is my last note about the ${service} estimate from ${when}. ` +
        `If the project is still open, we'd be glad to help, just reply. Otherwise, no need to respond and we'll close your file.\n\nThanks for considering ${biz}.\n\n${signOff}`
      );
  }
}
