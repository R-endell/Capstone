// src/services/disputeService.ts
import { supabase } from '../utils/supabase';

export type DisputeStatus = 'Awaiting Provider' | 'Under Review' | 'Resolved' | 'Dismissed';
export type IssueType = 'Lost' | 'Damaged' | 'Wrong item' | 'Not received' | 'Delayed' | 'Other';

export const ISSUE_TYPES: { type: IssueType; icon: string; hint: string }[] = [
  { type: 'Damaged', icon: 'alert-circle-outline', hint: 'Item arrived broken or damaged' },
  { type: 'Lost', icon: 'help-circle-outline', hint: 'Item was lost in transit' },
  { type: 'Not received', icon: 'close-circle-outline', hint: 'Marked delivered but not received' },
  { type: 'Wrong item', icon: 'swap-horizontal-outline', hint: 'Received a different item' },
  { type: 'Delayed', icon: 'time-outline', hint: 'Much later than expected' },
  { type: 'Other', icon: 'ellipsis-horizontal-circle-outline', hint: 'Something else went wrong' },
];

export interface Dispute {
  dispute_id: number;
  dispute_ref: string | null;
  delivery_id: number;
  request_id: number;
  reported_by: number;
  provider_id: number;
  issue_type: IssueType;
  description: string;
  status: DisputeStatus;
  provider_response: string | null;
  provider_responded_at: string | null;
  resolution: string | null;
  resolved_at: string | null;
  created_at: string;
  reporter?: { first_name: string | null; last_name: string | null } | null;
  provider?: { first_name: string | null; last_name: string | null } | null;
}

export const trackingIdFor = (requestId: number) => `PNS-${String(requestId).padStart(4, '0')}`;

/** "PNS-0012", "pns 12", "#12" or "12" -> 12 (null if invalid) */
export const parseTrackingId = (raw: string): number | null => {
  const digits = (raw || '').replace(/^\s*#?\s*pns[-\s]?/i, '').replace(/[^0-9]/g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export const displayName = (u?: { first_name: string | null; last_name: string | null } | null) =>
  u ? `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Unknown' : 'Unknown';

export const getMyUserId = async (): Promise<number | null> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('users').select('user_id').eq('auth_id', user.id).maybeSingle();
  return data?.user_id ?? null;
};

const SELECT = `
  *,
  reporter:users!disputes_reported_by_fkey ( first_name, last_name ),
  provider:users!disputes_provider_id_fkey ( first_name, last_name )
`;

export const fetchMyDisputes = async (): Promise<Dispute[]> => {
  const { data, error } = await supabase
    .from('disputes')
    .select(SELECT)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as any;
};

export const fetchDispute = async (id: number): Promise<Dispute | null> => {
  const { data, error } = await supabase.from('disputes').select(SELECT).eq('dispute_id', id).maybeSingle();
  if (error) throw error;
  return (data as any) ?? null;
};

export interface ReportableDelivery {
  request_id: number;
  tracking: string;
  status: string;
  route: string;
  providerName: string;
  date: string;
  hasOpenDispute: boolean;
}

/** Sender's deliveries that already have a provider (so a report can be filed). */
export const fetchReportableDeliveries = async (senderId: number): Promise<ReportableDelivery[]> => {
  const { data, error } = await supabase
    .from('delivery_requests')
    .select(`
      request_id, delivery_status, created_at, scheduled_time,
      pickup_location:locations!delivery_requests_pickup_location_id_fkey ( street_address ),
      dropoff_location:locations!delivery_requests_dropoff_location_id_fkey ( street_address ),
      deliveries ( delivery_id, provider:users!deliveries_provider_id_fkey ( first_name, last_name ) )
    `)
    .eq('sender_id', senderId)
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw error;

  const { data: open } = await supabase
    .from('disputes')
    .select('request_id')
    .in('status', ['Awaiting Provider', 'Under Review']);
  const openSet = new Set((open || []).map((o: any) => o.request_id));

  return (data || [])
    .filter((r: any) => r.deliveries && r.deliveries.length > 0)
    .map((r: any) => {
      const dt = new Date(r.scheduled_time || r.created_at);
      return {
        request_id: r.request_id,
        tracking: trackingIdFor(r.request_id),
        status: r.delivery_status || '',
        route: `${r.pickup_location?.street_address || 'Pickup'} → ${r.dropoff_location?.street_address || 'Dropoff'}`,
        providerName: displayName(r.deliveries[0]?.provider),
        date: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        hasOpenDispute: openSet.has(r.request_id),
      };
    });
};

export const createDispute = async (requestId: number, issueType: IssueType, description: string) => {
  const { data, error } = await supabase.rpc('create_dispute', {
    p_request_id: requestId,
    p_issue_type: issueType,
    p_description: description,
  });
  if (error) throw new Error(error.message);
  return data as Dispute;
};

export const respondToDispute = async (disputeId: number, response: string) => {
  const { data, error } = await supabase.rpc('respond_to_dispute', {
    p_dispute_id: disputeId,
    p_response: response,
  });
  if (error) throw new Error(error.message);
  return data as Dispute;
};

export const countAwaitingMyResponse = async (userId: number): Promise<number> => {
  const { count } = await supabase
    .from('disputes')
    .select('dispute_id', { count: 'exact', head: true })
    .eq('provider_id', userId)
    .eq('status', 'Awaiting Provider');
  return count || 0;
};

export const STATUS_STYLE: Record<DisputeStatus, { bg: string; fg: string; label: string }> = {
  'Awaiting Provider': { bg: '#FEF3C7', fg: '#92400E', label: 'Awaiting Provider' },
  'Under Review': { bg: '#DBEAFE', fg: '#1D4ED8', label: 'Under Review' },
  Resolved: { bg: '#DCFCE7', fg: '#166534', label: 'Resolved' },
  Dismissed: { bg: '#F3F4F6', fg: '#4B5563', label: 'Dismissed' },
};