// src/services/depositRefundService.ts
// Refunds the sender's "Return to Sender" deposit once a delivery was completed successfully.
// Used by the provider (TaskScreen, right after completion) and by the sender (ActivityScreen, self-heal retry).
import { supabase } from '../utils/supabase';

const REFUND_TIMEOUT_MS = 30000;

// refund_status values that mean "the deposit still has to be refunded"
const RETRYABLE = ['', 'deposit_refund_pending', 'failed', 'manual_required'];

// Retry each request at most once per app session so a permanent failure never loops.
const attemptedThisSession = new Set<number>();
const inFlight = new Set<number>();

export type DepositRefundResult = {
  ok: boolean;
  status: 'requested' | 'already_done' | 'failed' | 'manual_required' | 'skipped';
  message?: string;
};

const withTimeout = <T,>(p: PromiseLike<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Deposit refund timed out')), ms);
    Promise.resolve(p).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });

/** True when a completed (not returned / cancelled) delivery still owes the sender its deposit. */
export const needsDepositRefund = (row: any): boolean => {
  const deposit = Number(row?.return_deposit) || 0;
  if (deposit <= 0) return false;
  const rs = String(row?.refund_status ?? '').toLowerCase();
  return RETRYABLE.includes(rs);
};

export const wasDepositRefundAttempted = (requestId: number) => attemptedThisSession.has(Number(requestId));

export async function requestDepositRefund(requestId: number, amount?: number): Promise<DepositRefundResult> {
  const id = Number(requestId);
  if (!id || inFlight.has(id)) return { ok: false, status: 'skipped' };
  inFlight.add(id);
  attemptedThisSession.add(id);

  try {
    const { data: row } = await supabase
      .from('delivery_requests')
      .select('request_id, return_deposit, refund_status, payment_provider')
      .eq('request_id', id)
      .maybeSingle();

    const deposit = Number((row as any)?.return_deposit) || Number(amount) || 0;
    if (!row || deposit <= 0) return { ok: false, status: 'skipped' };

    const current = String((row as any).refund_status ?? '').toLowerCase();
    if (!RETRYABLE.includes(current)) return { ok: true, status: 'already_done' };

    // Flag the intent first: the edge function accepts a post-completion refund only for this state.
    if (current !== 'deposit_refund_pending') {
      await supabase.from('delivery_requests').update({ refund_status: 'deposit_refund_pending' }).eq('request_id', id);
    }

    const { data: result, error } = await withTimeout(
      supabase.functions.invoke('xendit-refund', {
        body: { request_id: id, amount: deposit, reason: 'REQUESTED_BY_CUSTOMER' },
      }),
      REFUND_TIMEOUT_MS,
    );

    if (error || !result?.success) {
      const manual = result?.needs_manual === true;
      await supabase
        .from('delivery_requests')
        .update({ refund_status: manual ? 'manual_required' : 'failed' })
        .eq('request_id', id);
      console.warn('[depositRefund] failed:', error?.message || result);
      return { ok: false, status: manual ? 'manual_required' : 'failed', message: result?.error || error?.message };
    }

    // audit row (once)
    try {
      const { data: existing } = await supabase
        .from('escrow_transactions')
        .select('id')
        .eq('request_id', id)
        .eq('event', 'deposit_refunded_to_sender')
        .limit(1);
      if (!existing || existing.length === 0) {
        const raw = String((row as any).payment_provider || '').toLowerCase();
        await supabase.from('escrow_transactions').insert({
          request_id: id,
          event: 'deposit_refunded_to_sender',
          amount: deposit,
          provider: ['gcash', 'maya'].includes(raw) ? raw : 'gcash',
          xendit_reference: result?.refund_id ?? null,
          notes: `Return deposit refunded to sender on completed delivery | Amount=₱${deposit} | refund=${result?.refund_id ?? 'n/a'}`,
        });
      }
    } catch (e) {
      console.warn('[depositRefund] audit row failed:', e);
    }

    return { ok: true, status: 'requested' };
  } catch (e: any) {
    // timeout / network: leave it retryable, do not mark it as permanently failed
    console.warn('[depositRefund] exception:', e?.message || e);
    try {
      await supabase.from('delivery_requests').update({ refund_status: 'failed' }).eq('request_id', id);
    } catch { /* ignore */ }
    return { ok: false, status: 'failed', message: e?.message };
  } finally {
    inFlight.delete(id);
  }
}