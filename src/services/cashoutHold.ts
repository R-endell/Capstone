// src/services/cashoutHold.ts
// 24-hour cash-out hold: an earning only becomes cashable 24 hours after the
// delivery was completed. Shared by EarningsScreen and CashoutScreen.
import { supabase } from '../utils/supabase';

export const CASHOUT_HOLD_MS = 24 * 60 * 60 * 1000;
const PLATFORM_FEE_RATE = 0.15;
const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

export interface HeldEarning {
  escrowId: number;
  amount: number;      // what the courier receives for this delivery
  cashableAt: number;  // ms epoch
}

export const toMs = (ts: string | null | undefined): number | null => {
  if (!ts) return null;
  let raw = String(ts);
  // Naive DB timestamps are stored in UTC.
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) raw = raw.replace(' ', 'T') + 'Z';
  const ms = new Date(raw).getTime();
  return isNaN(ms) ? null : ms;
};

export const formatHoldCountdown = (ms: number): string => {
  const totalMins = Math.max(1, Math.ceil(ms / 60000));
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

/**
 * Earned (released) deliveries from the last 30 days with the time they unlock.
 * Throws on a query error so callers can fail closed.
 */
export async function fetchHeldEarnings(providerId: number): Promise<HeldEarning[]> {
  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const { data: escrows, error } = await supabase
    .from('escrow_payments')
    .select(`
      escrow_id, escrow_status, emergency_frozen, amount, created_at,
      delivery:deliveries!escrow_payments_delivery_id_fkey (
        completed_at,
        delivery_requests!deliveries_request_id_fkey ( base_fare, return_deposit, delivery_status )
      )
    `)
    .eq('provider_id', providerId)
    .gte('created_at', since);
  if (error) throw error;
  if (!escrows || escrows.length === 0) return [];

  const ids = escrows.map((e: any) => e.escrow_id);
  const { data: txns, error: txErr } = await supabase
    .from('transactions')
    .select('escrow_id, status, processed_at')
    .in('escrow_id', ids);
  if (txErr) throw txErr;
  const txnByEscrow: Record<number, any> = {};
  (txns || []).forEach((t: any) => { txnByEscrow[t.escrow_id] = t; });

  const rows: HeldEarning[] = [];
  for (const e of escrows as any[]) {
    const t = txnByEscrow[e.escrow_id];
    const escrowStatus = String(e.escrow_status || '').toLowerCase();
    const txnStatus = String(t?.status || '').toLowerCase();
    const isReleased = escrowStatus === 'released' || escrowStatus === 'completed';
    const earned = !e.emergency_frozen && escrowStatus !== 'refunded' && (isReleased || txnStatus === 'completed');
    if (!earned) continue;

    const delivery = e.delivery || {};
    const request = Array.isArray(delivery.delivery_requests) ? delivery.delivery_requests[0] : delivery.delivery_requests;
    const baseFare = request?.base_fare != null ? Number(request.base_fare) : 0;
    const deposit = request?.return_deposit != null ? Number(request.return_deposit) : 0;
    const isReturned = String(request?.delivery_status || '').toLowerCase() === 'returned';
    const escrowAmt = Number(e.amount || 0);
    const fee = baseFare > 0 ? Math.round(baseFare * PLATFORM_FEE_RATE * 100) / 100 : 0;
    const netBase = baseFare > 0 ? Math.round((baseFare - fee) * 100) / 100 : 0;
    const amount = isReturned ? (netBase + deposit || escrowAmt) : (netBase || escrowAmt);

    const base = toMs(delivery.completed_at) ?? toMs(t?.processed_at) ?? toMs(e.created_at);
    if (base == null) continue;
    rows.push({ escrowId: e.escrow_id, amount, cashableAt: base + CASHOUT_HOLD_MS });
  }
  return rows;
}

export function summarizeHold(rows: HeldEarning[], now: number): { locked: number; nextUnlockAt: number | null } {
  const held = rows.filter((r) => r.cashableAt > now);
  const locked = Math.round(held.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  const nextUnlockAt = held.reduce<number | null>((min, r) => (min == null || r.cashableAt < min ? r.cashableAt : min), null);
  return { locked, nextUnlockAt };
}