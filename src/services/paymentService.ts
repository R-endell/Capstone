import { supabase } from '../utils/supabase';
import { PaymentMethod, PaymentProvider, CreateSessionResponse } from '../types/payment';

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

  if (error) throw error;
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