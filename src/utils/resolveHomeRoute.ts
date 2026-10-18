// src/utils/resolveHomeRoute.ts
//
// One place that decides which interface (Sender or Provider) a logged-in user
// may open. Both LoadingScreen and LoginScreen used to trust the device-wide
// `last_mode` value without checking who is logged in or whether that user is
// an approved provider. That is how a Sender could land in the Provider UI.
//
// Eligibility rule (same one AccountScreen already uses):
//   user has the 'Provider' role in user_roles
//   AND their latest provider_verifications row is 'approved' / 'verified'.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export type HomeRoute = 'MainTabs' | 'ProviderTabs';

const MODE_KEY = 'last_mode';
const MODE_USER_KEY = 'last_mode_user';

/** Remember the mode, tagged with the account it belongs to. */
export async function setLastMode(mode: 'sender' | 'provider'): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    await AsyncStorage.setItem(MODE_KEY, mode);
    if (session?.user?.id) await AsyncStorage.setItem(MODE_USER_KEY, session.user.id);
  } catch {}
}

/** Forget the remembered mode (logout / account switch / ineligible). */
export async function clearLastMode(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([MODE_KEY, MODE_USER_KEY]);
  } catch {}
}

/**
 * true  = approved provider
 * false = definitely NOT an approved provider
 * null  = could not be determined (network/DB error)
 */
export async function isApprovedProvider(authUserId: string): Promise<boolean | null> {
  try {
    const { data: userRow, error: uErr } = await supabase
      .from('users').select('user_id').eq('auth_id', authUserId).maybeSingle();
    if (uErr) return null;
    if (!userRow) return false;

    const { data: roles, error: rErr } = await supabase
      .from('user_roles')
      .select('role_id, roles!inner (role_name)')
      .eq('user_id', userRow.user_id);
    if (rErr) return null;
    const hasProviderRole = (roles || []).some((ur: any) => ur.roles?.role_name === 'Provider');
    if (!hasProviderRole) return false;

    const { data: verif, error: vErr } = await supabase
      .from('provider_verifications')
      .select('verification_status, submitted_at')
      .eq('provider_id', userRow.user_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (vErr) return null;
    if (!verif) return false;

    const status = String(verif.verification_status || '').toLowerCase();
    return status === 'approved' || status === 'verified';
  } catch {
    return null;
  }
}

/**
 * Decide where to send a logged-in user. Defaults to the Sender interface.
 * Provider is returned only when the user was last in provider mode, that
 * memory belongs to THIS account, and they are an approved provider.
 */
export async function resolveHomeRoute(authUserId: string): Promise<HomeRoute> {
  try {
    const lastMode = await AsyncStorage.getItem(MODE_KEY);
    if (lastMode !== 'provider') return 'MainTabs';

    const owner = await AsyncStorage.getItem(MODE_USER_KEY);
    if (owner && owner !== authUserId) {
      // Left over from a different account on this device.
      await clearLastMode();
      return 'MainTabs';
    }

    const approved = await isApprovedProvider(authUserId);
    if (approved === true) return 'ProviderTabs';
    if (approved === false) await clearLastMode(); // stale / ineligible
    return 'MainTabs'; // false or unknown -> safe default
  } catch {
    return 'MainTabs';
  }
}