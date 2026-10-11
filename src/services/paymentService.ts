import { supabase } from '../utils/supabase';
import { PaymentMethod, PaymentProvider, CreateSessionResponse } from '../types/payment';
import { FunctionsHttpError } from '@supabase/supabase-js';

export interface ChargeDeliveryResponse {
  status: 'processing' | 'held';
  payment_url?: string;
  message?: string;
}

export async function chargeDelivery(
  requestId: number,
  provider: PaymentProvider,
): Promise<ChargeDeliveryResponse> {
  const { data, error } = await supabase.functions.invoke<ChargeDeliveryResponse>(
    'xendit-charge-delivery',
    { body: { requestId, provider } },
  );

  if (error) {
    if (error instanceof FunctionsHttpError) {
      try {
        const body = await error.context.json();
        console.error('charge-delivery error:', body);
        throw new Error(body?.error || JSON.stringify(body));
      } catch (e: any) {
        throw new Error(e?.message || 'Payment failed');
      }
    }
    throw error;
  }

  if (!data) throw new Error('No response from charge-delivery');
  return data;
}

export async function getDeliveryPaymentStatus(requestId: number): Promise<{
  payment_status: string;
  escrow_status: string;
}> {
  const { data, error } = await supabase
    .from('delivery_requests')
    .select('payment_status, escrow_status')
    .eq('request_id', requestId)
    .single();

  if (error) throw error;
  return data;
}

export async function fetchPaymentMethods(userId: number): Promise<PaymentMethod[]> {
  const { data, error } = await supabase
    .from('user_payment_methods')
    .select('*')
    .eq('user_id', userId)
    .order('is_default', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function createLinkSession(
  userId: number,
  provider: PaymentProvider
): Promise<string> {
  const { data, error } = await supabase.functions.invoke<CreateSessionResponse>(
    'xendit-create-session',
    { body: { userId, provider } }
  );

  if (error) {
    if (error instanceof FunctionsHttpError) {
      try {
        const body = await error.context.json();
        console.error('xendit-create-session error:', body);
        throw new Error(body?.error || JSON.stringify(body));
      } catch (e: any) {
        throw new Error(e?.message || 'Payment session failed');
      }
    }
    throw error;
  }

  if (!data) throw new Error('Payment session data was not returned');
  return data.payment_link_url;
}

export async function unlinkPaymentMethod(
  userId: number,
  provider: PaymentProvider
): Promise<void> {
  const { error } = await supabase.functions.invoke('xendit-unlink', {
    body: { userId, provider },
  });
  if (error) throw error;
}

export async function setDefaultPaymentMethod(
  userId: number,
  provider: PaymentProvider
): Promise<void> {
  const { error } = await supabase.functions.invoke('xendit-set-default', {
    body: { userId, provider },
  });
  if (error) throw error;
}