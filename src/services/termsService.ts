// src/services/termsService.ts
// Recording and checking acceptance of the Terms and Policies (Section 13 of the draft).
// The text and the version live in src/modules/Settings/policyContent.ts, so changing
// POLICY_VERSION there makes every user be asked to accept again.
import { supabase } from '../utils/supabase';
import { getMyUserId } from './disputeService';
import {
  MAX_ITEM_VALUE, POLICY_VERSION, REPORT_WINDOW_HOURS, SIZE_LIMITS,
} from '../modules/Settings/policyContent';

export type TermsContext = 'signup' | 'provider_application' | 'route_post' | 'booking' | 'update';

/** Which pop-up text to show. 'general' is for account creation and for "the Terms changed". */
export type TermsVariant = 'sender' | 'provider' | 'general';

/**
 * true  = the pop-up appears every time (the draft: "shown before a booking is confirmed",
 *         "again when a trip is posted").
 * false = only once per Terms version. Flip a value here to change the rule, nothing else.
 */
export const ACCEPT_EVERY_TIME: Record<TermsContext, boolean> = {
  signup: false,
  provider_application: false,
  route_post: true,
  booking: true,
  update: false,
};

export const recordTermsAcceptance = async (context: TermsContext, referenceId?: number | null) => {
  const { error } = await supabase.rpc('record_terms_acceptance', {
    p_context: context,
    p_version: POLICY_VERSION,
    p_reference_id: referenceId ?? null,
  });
  if (error) throw new Error(error.message);
};

/** Has the signed-in user accepted the CURRENT version (in this context, or in any context)? */
export const hasAcceptedCurrentVersion = async (context?: TermsContext): Promise<boolean> => {
  const me = await getMyUserId();
  if (!me) return false;
  let q = supabase
    .from('terms_acceptances')
    .select('acceptance_id', { count: 'exact', head: true })
    .eq('user_id', me)
    .eq('version', POLICY_VERSION);
  if (context) q = q.eq('context', context);
  const { count, error } = await q;
  if (error) throw error;
  return (count || 0) > 0;
};

/** Should the pop-up be shown now? When the check itself fails we ask (the safe side for a legal step). */
export const needsAcceptance = async (context: TermsContext): Promise<boolean> => {
  if (ACCEPT_EVERY_TIME[context]) return true;
  try {
    return !(await hasAcceptedCurrentVersion(context));
  } catch {
    return true;
  }
};

// ---------------------------------------------------------------- pop-up text

const peso = (n: number) => `₱${n.toLocaleString('en-US')}`;
const caps = SIZE_LIMITS.map(s => `${s.label} ${peso(s.amount)}`).join(', ');

export const TERMS_COPY: Record<TermsVariant, { title: string; subtitle: string; cta: string; points: string[] }> = {
  sender: {
    title: 'Before you confirm this booking',
    subtitle: 'Please read the key points. You can open the full Terms and Policies any time.',
    cta: 'Agree and book',
    points: [
      'Pack-N-Ship is a platform only. The Provider, not Pack-N-Ship, delivers your package.',
      'Your package must match the size you selected and must not be a prohibited item.',
      `Only items valued below ${peso(MAX_ITEM_VALUE)} can be booked. Compensation is capped by size: ${caps}.`,
      'Photo evidence with date and time is required at pick-up and drop-off.',
      `Report damage within ${REPORT_WINDOW_HOURS.damaged} hours and loss within ${REPORT_WINDOW_HOURS.lost} hours.`,
      'A small Security Fund contribution applies to this delivery.',
      'Fraud can lead to deactivation of your account.',
    ],
  },
  provider: {
    title: 'Before you continue',
    subtitle: 'Please read the key points. You can open the full Terms and Policies any time.',
    cta: 'Agree and continue',
    points: [
      'Pack-N-Ship is a platform only. You deliver as an independent Provider.',
      'You are responsible for the package in your custody and are liable for proven damage or loss.',
      'Take clear pick-up and drop-off photos with date and time stamp for every delivery.',
      `Do not carry prohibited items or items valued at ${peso(MAX_ITEM_VALUE)} or more.`,
      'A small Security Fund contribution applies to each delivery.',
      'Fraud or false evidence can lead to deactivation of your account.',
    ],
  },
  general: {
    title: 'Terms and Policies',
    subtitle: 'The key points for everyone who uses Pack-N-Ship.',
    cta: 'Agree and continue',
    points: [
      'Pack-N-Ship is a platform only. Providers carry packages as independent travellers, not as Pack-N-Ship.',
      `Only items valued below ${peso(MAX_ITEM_VALUE)} can be sent, and prohibited items are never allowed.`,
      'Photos with date and time are required at pick-up and drop-off.',
      `Problems must be reported in the app: damage within ${REPORT_WINDOW_HOURS.damaged} hours, loss within ${REPORT_WINDOW_HOURS.lost} hours.`,
      'Your personal data is handled under the Data Privacy Act of 2012 (Republic Act No. 10173).',
      'Fraud, fake evidence or unsafe behavior can lead to deactivation of your account.',
    ],
  },
};