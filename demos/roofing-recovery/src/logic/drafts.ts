import { CONTRACTOR } from './contractor.ts';
import { formatShortDate } from './dates.ts';
import type { Lead, Situation } from './types.ts';
import { situationOf } from './priority.ts';

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function serviceText(service: string): string {
  // Drop parenthetical detail and lower-case the first letter so it reads naturally mid-sentence.
  const plain = service.replace(/\s*\([^)]*\)/g, '').trim();
  return plain.charAt(0).toLowerCase() + plain.slice(1);
}

function estimateDate(lead: Lead): string | null {
  const sent = [...lead.history].reverse().find((e) => e.direction === 'outbound' && /estimate/i.test(e.summary));
  return sent ? formatShortDate(sent.date) : null;
}

const SIGN_OFF = `${CONTRACTOR.firstName}, ${CONTRACTOR.company}\n${CONTRACTOR.phone}`;

/** Suggested follow-up message, personalised from the lead record. */
export function suggestedDraft(lead: Lead, situation: Situation = situationOf(lead)): string {
  const name = firstName(lead.name);
  const service = serviceText(lead.service);

  switch (situation) {
    case 'unanswered_inquiry':
      return (
        `Hi ${name}, this is ${CONTRACTOR.firstName} with ${CONTRACTOR.company}. ` +
        `I'm sorry we didn't get back to you sooner about the ${service} at your home in ${lead.city}. ` +
        `We'd still be glad to help. Would a free inspection later this week work for you? ` +
        `Just reply with a day and time that suits you.\n\n${SIGN_OFF}`
      );
    case 'estimate_no_response': {
      const sent = estimateDate(lead);
      return (
        `Hi ${name}, it's ${CONTRACTOR.firstName} with ${CONTRACTOR.company}. ` +
        `I wanted to follow up on the ${service} estimate we sent${sent ? ` on ${sent}` : ''}. ` +
        `Happy to answer any questions, go over material options, or adjust the scope if that helps. ` +
        `If you've decided to go another direction, no problem. Just let me know and I'll close out your file.\n\n${SIGN_OFF}`
      );
    }
    case 'unanswered_reply':
      return (
        `Hi ${name}, thanks for getting back to us, and sorry for the slow reply. ` +
        `Let's get your ${service} taken care of. I'll give you a call today to set a time, ` +
        `or reply here with what works best for you.\n\n${SIGN_OFF}`
      );
    case 'stalled_conversation':
      return (
        `Hi ${name}, ${CONTRACTOR.firstName} from ${CONTRACTOR.company} here, following up on the ${service} we talked about. ` +
        `Are you still looking to get this done? I can set up a free inspection in ${lead.city} at a time that suits you.\n\n${SIGN_OFF}`
      );
  }
}

/** The text the team would send: the reviewer's edit if any, otherwise the suggestion. */
export function currentDraft(lead: Lead): string {
  return lead.followUp.draft ?? suggestedDraft(lead);
}
