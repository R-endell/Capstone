// src/services/withdrawalService.ts
import { supabase } from '../utils/supabase';
import { FunctionsHttpError } from '@supabase/supabase-js';
import {
  PaymentProvider,
  ProviderWallet,
  WithdrawalRequest,
  RequestCashoutPayload,
  RequestCashoutResponse,
} from '../types/payment';

export const MIN_CASHOUT_AMOUNT = 100;
export const MAX_CASHOUT_AMOUNT = 50000;

// Xendit Test Mode magic account numbers (https://docs.xendit.co/docs/test-scenarios-payouts)
export const XENDIT_TEST_SCENARIO_NUMBERS = new Set([
  '121212',   // INVALID_DESTINATION
  '999999',   // REJECTED_BY_CHANNEL
  '123456',   // TEMPORARY_TRANSFER_ERROR
  '98018521', // TRANSFER_ERROR
  '79018761', // SLS_RECIPIENT (with "Walter White")
]);

export function isValidPhMobileOrTestNumber(
  rawNumber: string,
  allowTestMagic = true,
): boolean {
  const cleaned = String(rawNumber || '').replace(/\s+/g, '');
  if (/^09\d{9}$/.test(cleaned)) return true;
  if (allowTestMagic && XENDIT_TEST_SCENARIO_NUMBERS.has(cleaned)) return true;
  return false;
}

export function isSavedWalletNumberValid(num?: string | null): boolean {
  if (!num) return false;
  return /^09\d{9}$/.test(String(num).replace(/\s+/g, ''));
}

async function parseEdgeFunctionError(
  error: any,
  fallbackMessage: string,
): Promise<string> {
  if (!error) return fallbackMessage;
  if (error instanceof FunctionsHttpError || error?.context) {
    try {
      const body = await error.context.json();
      if (body?.error) return String(body.error);
      if (body?.message) return String(body.message);
    } catch {
      // ignore JSON parse failure
    }
  }
  const msg = String(error?.message || '');
  if (msg && !msg.includes('FunctionsHttpError') && !msg.includes('non-2xx')) {
    return msg;
  }
  return fallbackMessage;
}

export function generateCashoutIdempotencyKey(providerId?: number | null): string {
  const rand =
    Math.random().toString(36).substring(2, 10) +
    Math.random().toString(36).substring(2, 10);
  return `pns_${providerId || 'prv'}_${Date.now()}_${rand}`;
}

export async function fetchProviderWallet(
  providerId: number,
): Promise<ProviderWallet | null> {
  try {
    const { data, error } = await supabase
      .from('provider_wallet')
      .select('*')
      .eq('provider_id', providerId)
      .maybeSingle();

    if (error) {
      console.warn('[withdrawalService] fetchProviderWallet error:', error.message);
      throw new Error('Could not load your wallet balance. Please pull to refresh.');
    }
    return (data as ProviderWallet) || null;
  } catch (err: any) {
    throw new Error(err?.message || 'Could not load your wallet balance.');
  }
}

export async function fetchWithdrawalHistory(
  walletId: number,
): Promise<WithdrawalRequest[]> {
  try {
    const { data, error } = await supabase
      .from('withdrawal_requests')
      .select('*')
      .eq('provider_wallet_id', walletId)
      .order('requested_at', { ascending: false })
      .limit(50);

    if (error) {
      console.warn('[withdrawalService] fetchWithdrawalHistory error:', error.message);
      throw new Error('Could not load withdrawal history.');
    }
    return ((data || []) as WithdrawalRequest[]).map((r) => ({
      ...r,
      amount: Number(r.amount || 0),
    }));
  } catch (err: any) {
    throw new Error(err?.message || 'Could not load withdrawal history.');
  }
}

export async function requestProviderCashout(
  payload: RequestCashoutPayload,
): Promise<RequestCashoutResponse> {
  try {
    const { data, error } = await supabase.functions.invoke<RequestCashoutResponse>(
      'xendit-disburse',
      {
        body: {
          action: 'create',
          amount: payload.amount,
          method: payload.method,
          accountNumber: payload.accountNumber.replace(/\s+/g, ''),
          accountHolderName: payload.accountHolderName.trim(),
          idempotencyKey: payload.idempotencyKey,
          saveDestination: payload.saveDestination ?? true,
        },
      },
    );

    if (error) {
      const friendly = await parseEdgeFunctionError(
        error,
        'Cashout request could not be completed. Please try again.',
      );
      throw new Error(friendly);
    }

    if (!data) {
      throw new Error('No response received from the payout server.');
    }

    if ((data as any).error) {
      throw new Error(String((data as any).error));
    }

    return data;
  } catch (err: any) {
    throw new Error(
      err?.message || 'Cashout request could not be completed. Please try again.',
    );
  }
}

export async function reconcileWithdrawalStatus(
  withdrawalId: number,
): Promise<WithdrawalRequest | null> {
  try {
    const { data, error } = await supabase.functions.invoke<{
      success: boolean;
      withdrawal?: WithdrawalRequest;
      message?: string;
    }>('xendit-disburse', {
      body: {
        action: 'reconcile',
        withdrawalId,
      },
    });

    if (error) {
      const friendly = await parseEdgeFunctionError(
        error,
        'Could not refresh payout status right now.',
      );
      throw new Error(friendly);
    }

    return data?.withdrawal || null;
  } catch (err: any) {
    throw new Error(err?.message || 'Could not refresh payout status right now.');
  }
}

export async function savePayoutDestination(
  method: PaymentProvider,
  accountNumber: string,
  accountHolderName?: string,
): Promise<ProviderWallet> {
  try {
    const { data, error } = await supabase.functions.invoke<{
      success: boolean;
      wallet: ProviderWallet;
      error?: string;
    }>('xendit-disburse', {
      body: {
        action: 'save_destination',
        method,
        accountNumber: accountNumber.replace(/\s+/g, ''),
        accountHolderName: accountHolderName?.trim() || null,
      },
    });

    if (error) {
      const friendly = await parseEdgeFunctionError(
        error,
        'Could not save payout account details.',
      );
      throw new Error(friendly);
    }

    if (!data?.wallet) {
      throw new Error('Could not save payout account details.');
    }

    return data.wallet;
  } catch (err: any) {
    throw new Error(err?.message || 'Could not save payout account details.');
  }
}