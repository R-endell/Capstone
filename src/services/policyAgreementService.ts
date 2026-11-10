// src/services/policyAgreementService.ts
// Saves and checks "I agree" records in the policy_acceptances table
// (see supabase/20261109_policy_acceptances.sql).
import { supabase } from '../utils/supabase';
import { getMyUserId } from './disputeService';
import { POLICY_VERSION, PolicyId } from '../modules/Settings/policyContent';

export type AgreementRole = 'sender' | 'provider';

/** The policies a provider must accept before starting a route. */
export const PROVIDER_ROUTE_POLICIES: PolicyId[] = ['provider', 'damage'];

export const recordAcceptance = async (opts: {
  policyIds: PolicyId[];
  role: AgreementRole;
  context: 'booking_payment' | 'route_start';
  requestId?: number | null;
}) => {
  const me = await getMyUserId();
  if (!me) throw new Error('Please sign in again.');
  const rows = opts.policyIds.map(policy_id => ({
    user_id: me,
    policy_id,
    policy_version: POLICY_VERSION,
    role: opts.role,
    context: opts.context,
    request_id: opts.requestId ?? null,
  }));
  const { error } = await supabase.from('policy_acceptances').insert(rows);
  if (error) throw new Error(error.message);
};

/** True when this user has accepted every listed policy in the CURRENT version. */
export const hasAccepted = async (policyIds: PolicyId[], role: AgreementRole): Promise<boolean> => {
  const me = await getMyUserId();
  if (!me) return false;
  const { data, error } = await supabase
    .from('policy_acceptances')
    .select('policy_id')
    .eq('user_id', me)
    .eq('role', role)
    .eq('policy_version', POLICY_VERSION)
    .in('policy_id', policyIds);
  if (error) throw error;
  const got = new Set((data || []).map((r: any) => r.policy_id));
  return policyIds.every(id => got.has(id));
};