// src/services/ticketService.ts
import { supabase } from '../utils/supabase';
import { notifyUser } from './pushService';
import { getMyUserId, trackingIdFor, displayName } from './disputeService';
import type { Role, TicketType, LegacyIssueType } from './ticketCatalog';

export { getMyUserId, trackingIdFor, displayName };

export const ATTACHMENT_BUCKET = 'ticket-attachments';
export const MAX_PHOTOS = 6;

export type TicketStatus =
  | 'Open' | 'Awaiting Other Party' | 'In Review' | 'Awaiting Reporter' | 'Resolved' | 'Closed';

type Person = { first_name: string | null; last_name: string | null } | null;

export interface Ticket {
  ticket_id: number;
  ticket_ref: string | null;
  type: TicketType;
  category: string;
  sub_issue: string;
  description: string;
  requested_resolution: string | null;
  status: TicketStatus;
  reporter_id: number;
  reporter_role: Role;
  counterparty_id: number | null;
  delivery_id: number | null;
  request_id: number | null;
  legacy_dispute_id: number | null;
  resolution: string | null;
  resolved_at: string | null;
  last_activity_at: string;
  created_at: string;
  reporter?: Person;
  counterparty?: Person;
}

export interface Attachment { path: string; name?: string }

export interface TicketMessage {
  message_id: number;
  ticket_id: number;
  sender_id: number | null;
  sender_kind: 'reporter' | 'counterparty' | 'staff' | 'system';
  body: string;
  attachments: Attachment[];
  /** null = shared with both parties; otherwise the one user whose private thread this belongs to. */
  audience_id: number | null;
  created_at: string;
}

export interface TicketEvent {
  event_id: number;
  ticket_id: number;
  status: string;
  note: string | null;
  created_at: string;
}

const TICKET_SELECT = `
  *,
  reporter:users!support_tickets_reporter_id_fkey ( first_name, last_name ),
  counterparty:users!support_tickets_counterparty_id_fkey ( first_name, last_name )
`;

export const isClosed = (s: TicketStatus) => s === 'Resolved' || s === 'Closed';

// ---------------------------------------------------------------- queries

export const fetchMyTickets = async (): Promise<Ticket[]> => {
  const me = await getMyUserId();
  if (!me) return [];
  const { data, error } = await supabase
    .from('support_tickets')
    .select(TICKET_SELECT)
    .or(`reporter_id.eq.${me},counterparty_id.eq.${me}`)
    .order('last_activity_at', { ascending: false });
  if (error) throw error;
  return (data || []) as any;
};

export const fetchTicket = async (ticketId: number): Promise<Ticket | null> => {
  const { data, error } = await supabase
    .from('support_tickets').select(TICKET_SELECT).eq('ticket_id', ticketId).maybeSingle();
  if (error) throw error;
  return (data as any) ?? null;
};

/** Old notifications/deep links point at a dispute id; find the ticket that mirrors it. */
export const fetchTicketIdByDispute = async (disputeId: number): Promise<number | null> => {
  const { data } = await supabase
    .from('support_tickets').select('ticket_id').eq('legacy_dispute_id', disputeId).maybeSingle();
  return data?.ticket_id ?? null;
};

export const fetchThread = async (ticketId: number) => {
  const [m, e] = await Promise.all([
    supabase.from('ticket_messages').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true }),
    supabase.from('ticket_events').select('*').eq('ticket_id', ticketId).order('created_at', { ascending: true }),
  ]);
  if (m.error) throw m.error;
  if (e.error) throw e.error;
  return { messages: (m.data || []) as TicketMessage[], events: (e.data || []) as TicketEvent[] };
};

export interface MyDelivery {
  delivery_id: number;
  request_id: number;
  tracking: string;
  route: string;
  otherName: string;
  date: string;
  status: string;
  myRole: Role;
  /** An open dispute-type report you already filed on this delivery. */
  openTicketId: number | null;
}

const DELIVERY_SELECT = `
  delivery_id, request_id, provider_id, accepted_at,
  provider:users!deliveries_provider_id_fkey ( first_name, last_name ),
  delivery_requests!inner (
    sender_id, delivery_status, created_at, scheduled_time,
    pickup:locations!delivery_requests_pickup_location_id_fkey ( street_address ),
    dropoff:locations!delivery_requests_dropoff_location_id_fkey ( street_address ),
    sender:users!delivery_requests_sender_id_fkey ( first_name, last_name )
  )
`;

/** Recent deliveries the signed-in user took part in, as sender and/or provider. */
export const fetchMyDeliveries = async (roles: Role[] = ['sender', 'provider']): Promise<MyDelivery[]> => {
  const me = await getMyUserId();
  if (!me) return [];

  const run = async (role: Role) => {
    let q = supabase.from('deliveries').select(DELIVERY_SELECT).order('accepted_at', { ascending: false }).limit(25);
    q = role === 'sender' ? q.eq('delivery_requests.sender_id', me) : q.eq('provider_id', me);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map((r: any): MyDelivery => {
      const rq = r.delivery_requests;
      const dt = new Date(rq?.scheduled_time || rq?.created_at || r.accepted_at);
      return {
        delivery_id: r.delivery_id,
        request_id: r.request_id,
        tracking: trackingIdFor(r.request_id),
        route: `${rq?.pickup?.street_address || 'Pickup'} → ${rq?.dropoff?.street_address || 'Drop-off'}`,
        otherName: displayName(role === 'sender' ? r.provider : rq?.sender),
        date: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        status: rq?.delivery_status || '',
        myRole: role,
        openTicketId: null,
      };
    });
  };

  const lists = await Promise.all(roles.map(run));
  const all = lists.flat();

  const { data: open } = await supabase
    .from('support_tickets')
    .select('ticket_id, delivery_id')
    .eq('reporter_id', me)
    .eq('type', 'dispute')
    .not('status', 'in', '(Resolved,Closed)')
    .not('delivery_id', 'is', null);
  const openMap = new Map<number, number>((open || []).map((o: any) => [o.delivery_id, o.ticket_id]));

  return all.map(d => ({ ...d, openTicketId: openMap.get(d.delivery_id) ?? null }));
};

/** Tickets waiting on me (used for the badge on the help button). */
export const countNeedingMyAction = async (): Promise<number> => {
  const me = await getMyUserId();
  if (!me) return 0;
  const [a, b] = await Promise.all([
    supabase.from('support_tickets').select('ticket_id', { count: 'exact', head: true })
      .eq('counterparty_id', me).eq('status', 'Awaiting Other Party'),
    supabase.from('support_tickets').select('ticket_id', { count: 'exact', head: true })
      .eq('reporter_id', me).eq('status', 'Awaiting Reporter'),
  ]);
  return (a.count || 0) + (b.count || 0);
};

// ---------------------------------------------------------------- writes

export interface CreateTicketInput {
  type: TicketType;
  category: string;
  subIssue: string;
  description: string;
  role: Role;
  deliveryId?: number | null;
  requestedResolution?: string | null;
  attachments?: Attachment[];
  legacyIssueType?: LegacyIssueType;
}

export const createTicket = async (input: CreateTicketInput): Promise<Ticket> => {
  const { data, error } = await supabase.rpc('create_ticket', {
    p_type: input.type,
    p_category: input.category,
    p_sub_issue: input.subIssue,
    p_description: input.description,
    p_delivery_id: input.deliveryId ?? null,
    p_role: input.role,
    p_requested_resolution: input.requestedResolution ?? null,
    p_attachments: input.attachments ?? [],
    p_legacy_issue_type: input.legacyIssueType ?? 'Other',
  });
  if (error) throw new Error(error.message);
  const t = data as Ticket;

  // The DB already wrote the in-app notification; this sends the device push.
  if (t.counterparty_id) {
    notifyUser(
      t.counterparty_id,
      `Issue reported on ${t.request_id ? trackingIdFor(t.request_id) : 'a delivery'}`,
      `A ${t.reporter_role} reported: ${t.sub_issue}. Open the report to see the details and photos, then tap Dispute to explain your side.`,
      { type: 'ticket', ticketId: t.ticket_id },
    );
  }
  return t;
};

/** Replies are private between you and the support team; the other party never sees them. */
export const sendMessage = async (ticket: Ticket, body: string, attachments: Attachment[] = []) => {
  const { data, error } = await supabase.rpc('add_ticket_message', {
    p_ticket_id: ticket.ticket_id,
    p_body: body,
    p_attachments: attachments,
  });
  if (error) throw new Error(error.message);
  return data as TicketMessage;
};

// ---------------------------------------------------------------- photos

/** Uploads local image URIs to the private bucket; returns the stored attachments. */
export const uploadPhotos = async (userId: number, uris: string[]): Promise<Attachment[]> => {
  const stamp = Date.now();
  return Promise.all(
    uris.map(async (uri, i) => {
      const ext = (uri.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
      const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(ext) ? ext : 'jpg';
      const path = `${userId}/${stamp}-${i}.${safeExt}`;
      const buf = await (await fetch(uri)).arrayBuffer();
      const { error } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(path, buf, {
        contentType: safeExt === 'jpg' ? 'image/jpeg' : `image/${safeExt}`,
        upsert: false,
      });
      if (error) throw new Error(`Photo upload failed: ${error.message}`);
      return { path };
    }),
  );
};

export const signAttachmentUrls = async (paths: string[]): Promise<Record<string, string>> => {
  const unique = Array.from(new Set(paths));
  if (unique.length === 0) return {};
  const { data } = await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrls(unique, 3600);
  const out: Record<string, string> = {};
  (data || []).forEach((d: any) => { if (d?.path && d?.signedUrl) out[d.path] = d.signedUrl; });
  return out;
};

// ---------------------------------------------------------------- realtime

/** Calls onChange when a ticket (or, with ticketId, its messages/events) changes. Returns unsubscribe. */
export const subscribeTickets = (onChange: () => void, ticketId?: number) => {
  const name = `tickets-${ticketId ?? 'all'}-${Math.random().toString(36).slice(2, 8)}`;
  const f = (table: string): any => ({
    event: '*', schema: 'public', table,
    ...(ticketId ? { filter: `ticket_id=eq.${ticketId}` } : {}),
  });
  let ch: any = supabase.channel(name).on('postgres_changes' as any, f('support_tickets'), onChange);
  if (ticketId) {
    ch = ch.on('postgres_changes', f('ticket_messages'), onChange)
           .on('postgres_changes', f('ticket_events'), onChange);
  }
  ch.subscribe();
  return () => { supabase.removeChannel(ch); };
};

// ---------------------------------------------------------------- presentation

export type Tone = 'action' | 'review' | 'wait' | 'done';
export interface StatusView { label: string; tone: Tone; hint: string }

/** Status wording depends on who is looking at the ticket. */
export const statusView = (t: Ticket, myId: number | null): StatusView => {
  const iAmCounterparty = !!myId && t.counterparty_id === myId;
  const otherLabel = t.reporter_role === 'sender' ? 'provider' : 'sender';
  switch (t.status) {
    case 'Open':
      return { label: 'Submitted', tone: 'review', hint: 'Our team will pick this up shortly.' };
    case 'Awaiting Other Party':
      return iAmCounterparty
        ? { label: 'Your response needed', tone: 'action', hint: 'Tell us your side of what happened.' }
        : { label: `Waiting for the ${otherLabel}`, tone: 'wait', hint: `The ${otherLabel} has been asked to respond.` };
    case 'In Review':
      return { label: 'Under review', tone: 'review', hint: 'Our team is reviewing the details.' };
    case 'Awaiting Reporter':
      return !iAmCounterparty
        ? { label: 'Needs your reply', tone: 'action', hint: 'Support asked for more information.' }
        : { label: 'Waiting for the reporter', tone: 'wait', hint: 'Support asked the reporter for more information.' };
    case 'Resolved':
      return { label: 'Resolved', tone: 'done', hint: 'A decision was made on this case.' };
    default:
      return { label: 'Closed', tone: 'done', hint: 'This case is closed.' };
  }
};

export interface TimelineStep { key: string; title: string; sub: string; done: boolean; current: boolean }

export const buildTimeline = (t: Ticket, events: TicketEvent[]): TimelineStep[] => {
  const at = (status: string) => {
    const e = events.find(x => x.status === status);
    return e ? fmtDateTime(e.created_at) : '';
  };
  const closed = isClosed(t.status);
  const hasCounterparty = !!t.counterparty_id;
  const waitingOther = t.status === 'Awaiting Other Party';
  const steps: TimelineStep[] = [
    { key: 'submitted', title: 'Submitted', sub: fmtDateTime(t.created_at), done: true, current: false },
  ];
  if (hasCounterparty) {
    steps.push({
      key: 'response',
      title: t.reporter_role === 'sender' ? 'Provider responds' : 'Sender responds',
      sub: waitingOther ? 'Waiting for their explanation' : at('In Review') || 'Done',
      done: !waitingOther, current: waitingOther,
    });
  }
  const inReview = !closed && !waitingOther;
  steps.push({
    key: 'review', title: 'Team review',
    sub: closed ? 'Completed' : inReview ? 'In progress' : 'Starts once everyone has responded',
    done: closed, current: inReview,
  });
  steps.push({
    key: 'decision', title: t.status === 'Closed' ? 'Closed' : 'Decision',
    sub: closed ? fmtDateTime(t.resolved_at || t.last_activity_at) : 'Pending',
    done: closed, current: false,
  });
  return steps;
};

// ---------------------------------------------------------------- formatting

export const fmtDateTime = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export const timeAgo = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z').getTime();
  const m = Math.max(0, Math.round((Date.now() - d) / 60000));
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  return days < 7 ? `${days}d ago` : fmtDateTime(iso);
};