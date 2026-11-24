import { formatShortDate, formatUsd } from './dates.ts';
import type { Channel, Contractor, EstimateRecord, TemplateKey } from './types.ts';

const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;

function serviceText(service: string): string {
  const plain = service.replace(/\s*\([^)]*\)/g, '').trim() || 'roofing project';
  return plain.charAt(0).toLowerCase() + plain.slice(1);
}

/**
 * Local, rule-based drafts. The operator edits them; the contractor approves them;
 * nothing here sends anything.
 */
export function draftText(template: TemplateKey, channel: Channel, record: EstimateRecord, contractor: Contractor): string {
  const name = first(record.customerName);
  const rep = first(contractor.primaryContact);
  const biz = contractor.businessName;
  const service = serviceText(record.service);
  const when = formatShortDate(record.estimateDate);
  const amount = record.estimateAmount > 0 ? ` (${formatUsd(record.estimateAmount)})` : '';
  const signOff = `${rep}\n${biz}${contractor.phone ? `\n${contractor.phone}` : ''}`;

  if (channel === 'phone' || template === 'call_script') {
    return [
      `Call ${record.customerName} about the ${service} estimate from ${when}${amount}.`,
      `- Introduce: "${rep} asked me to check in on behalf of ${biz}."`,
      `- Ask whether the project is still open and if they have questions about the estimate.`,
      `- If interested: note what they want next (callback, inspection, revised estimate).`,
      `- If they ask not to be contacted: record "Opted out" — no further outreach.`,
      `- Voicemail: brief, no pressure, leave ${contractor.phone || 'the office number'}.`,
    ].join('\n');
  }

  if (channel === 'sms') {
    const body =
      template === 'final'
        ? `Hi ${name}, ${rep} at ${biz} — last check-in on your ${service} estimate. If you'd like to talk, just reply. Otherwise we'll close your file. Reply STOP to opt out.`
        : `Hi ${name}, ${rep} at ${biz} here following up on your ${service} estimate from ${when}. Any questions I can answer? Reply STOP to opt out.`;
    return body;
  }

  switch (template) {
    case 'initial':
      return (
        `Hi ${name},\n\nThis is ${rep} with ${biz}. I wanted to follow up on the estimate we prepared for your ${service} on ${when}${amount}. ` +
        `Is the project still something you're considering? I'm happy to answer questions, walk through material options, or adjust the scope if that helps.\n\n` +
        `If you've already gone another direction, just let me know and I'll close out your file.\n\n${signOff}`
      );
    case 'unanswered':
      return (
        `Hi ${name},\n\nJust following up on my earlier note about your ${service} estimate. ` +
        `If you'd like to talk it over or have us take another look at the roof, reply here and we'll set a time that suits you.\n\n${signOff}`
      );
    case 'final':
      return (
        `Hi ${name},\n\nI don't want to keep filling your inbox, so this is my last note about the ${service} estimate from ${when}. ` +
        `If the project is still open, we'd be glad to help — just reply. Otherwise, no need to respond and we'll close your file.\n\nThanks for considering ${biz}.\n\n${signOff}`
      );
  }
}
