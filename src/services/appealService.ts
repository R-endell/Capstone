// src/services/appealService.ts
//
// Appeals, built only on what the app already has (no database change).
// An appeal is a new ticket of type 'support' with category "Appeal". Its description starts with
// "[Appeal of TKT-123]" so we can link it back to the decision being appealed and block a second one.
// The support team sees it in the same ticket list as every other report.
import { createTicket, fetchMyTickets, uploadPhotos, isClosed, Ticket } from './ticketService';
import type { Role } from './ticketCatalog';

export const APPEAL_CATEGORY = 'Appeal';
/** Keep in sync with the Package Damage and Protection Policy ("Appeals"). */
export const APPEAL_WINDOW_DAYS = 3;
export const APPEAL_MIN_CHARS = 20;

const refOf = (t: Ticket) => t.ticket_ref || `#${t.ticket_id}`;
const marker = (t: Ticket) => `[Appeal of ${refOf(t)}]`;

export const isAppeal = (t: Ticket) => t.category === APPEAL_CATEGORY;

const decidedAt = (t: Ticket) => {
  const iso = t.resolved_at || t.last_activity_at;
  return new Date(iso.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z').getTime();
};

export type AppealState = 'na' | 'available' | 'filed' | 'expired';

/** Whether `me` can appeal this ticket's decision, or already did. */
export const loadAppealState = async (
  ticket: Ticket, me: number,
): Promise<{ state: AppealState; appealTicketId?: number }> => {
  // Only a decided report can be appealed, and an appeal itself is final.
  if (ticket.type !== 'dispute' || ticket.status !== 'Resolved' || isAppeal(ticket)) return { state: 'na' };

  const mine = await fetchMyTickets();
  const existing = mine.find(x => isAppeal(x) && x.reporter_id === me && x.description.startsWith(marker(ticket)));
  if (existing) return { state: 'filed', appealTicketId: existing.ticket_id };

  const ageDays = (Date.now() - decidedAt(ticket)) / 86400000;
  return { state: ageDays <= APPEAL_WINDOW_DAYS ? 'available' : 'expired' };
};

export const submitAppeal = async (
  ticket: Ticket, me: number, text: string, photoUris: string[],
): Promise<Ticket> => {
  if (!isClosed(ticket.status)) throw new Error('This report has not been decided yet.');
  const iAmCounterparty = ticket.counterparty_id === me;
  const role: Role = iAmCounterparty
    ? (ticket.reporter_role === 'sender' ? 'provider' : 'sender')
    : ticket.reporter_role;

  const attachments = photoUris.length ? await uploadPhotos(me, photoUris) : [];
  const original = ticket.resolution ? `\n\nOriginal decision: ${ticket.resolution.slice(0, 300)}` : '';
  return createTicket({
    type: 'support',
    category: APPEAL_CATEGORY,
    subIssue: `Appeal of ${refOf(ticket)}`,
    description: `${marker(ticket)} ${text.trim()}${original}`,
    role,
    deliveryId: ticket.delivery_id,
    requestedResolution: 'Review the decision again',
    attachments,
    legacyIssueType: 'Other',
  });
};