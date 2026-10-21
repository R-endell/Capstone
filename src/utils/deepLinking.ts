// src/utils/deepLinking.ts
import { useEffect } from 'react';
import * as Linking from 'expo-linking';

export type DeepLinkResult = { route: string; params?: any } | null;

export const handleDeepLink = (url: string): DeepLinkResult => {
  const parsed = Linking.parse(url);
  const queryParams = (parsed.queryParams ?? {}) as Record<
    string,
    string | string[] | undefined
  >;

  // expo-linking puts things after `scheme://` in `hostname` sometimes,
  // and in `path` other times. Normalize to a single string.
  const rawPath = (parsed.path ?? '').replace(/^\//, '');
  const rawHost = ((parsed as any).hostname ?? '').replace(/^\//, '');
  const fullPath = rawHost ? (rawPath ? `${rawHost}/${rawPath}` : rawHost) : rawPath;

  const isMatch = (target: string) => rawPath === target || fullPath === target;

  // ---- Payment callback ----
  if (isMatch('payment/callback')) {
    const { payment_method_id, status } = queryParams;
    return {
      route: 'PaymentResult',
      params: { payment_method_id, status },
    };
  }

  // ---- Password reset ----
  if (isMatch('reset-password')) {
    const token_hash =
      typeof queryParams.token_hash === 'string' ? queryParams.token_hash : undefined;
    const type = typeof queryParams.type === 'string' ? queryParams.type : 'recovery';

    if (!token_hash) {
      console.warn('[DeepLink] reset-password missing token_hash');
      return null;
    }

    return {
      route: 'ResetPassword',
      params: { token_hash, type },
    };
  }

  // ---- EMAIL VERIFICATION ----
  if (isMatch('auth/confirm')) {
    // 1. Check for PKCE flow (code param)
    const code = typeof queryParams.code === 'string' ? queryParams.code : undefined;
    if (code) {
      return { route: 'VerifyEmail', params: { code } };
    }

    // 2. Check for Implicit flow (access_token in hash fragment)
    // Example: packnship://auth/confirm#access_token=xxx&refresh_token=yyy
    let access_token = typeof queryParams.access_token === 'string' ? queryParams.access_token : undefined;
    let refresh_token = typeof queryParams.refresh_token === 'string' ? queryParams.refresh_token : undefined;

    if (!access_token && url.includes('#')) {
      const hash = url.split('#')[1];
      const hashParams = new URLSearchParams(hash);
      access_token = hashParams.get('access_token') || undefined;
      refresh_token = hashParams.get('refresh_token') || undefined;
    }

    if (!access_token) {
      console.warn('[DeepLink] auth/confirm missing access_token or code');
      return null;
    }

    return {
      route: 'VerifyEmail',
      params: { access_token, refresh_token },
    };
  }

  return null;
};

/**
 * Listens for deep links (cold + warm start).
 */
export const useDeepLink = (navigationRef: React.RefObject<any>) => {
  useEffect(() => {
    let cancelled = false;
    const seen = new Set<string>();

    const navigateTo = (result: { route: string; params?: any }) => {
      let attempts = 0;
      const tryNavigate = () => {
        if (cancelled) return;
        const nav = navigationRef.current;
        if (nav?.isReady?.()) {
          try {
            nav.reset({
              index: 0,
              routes: [{ name: result.route, params: result.params }],
            });
          } catch (e) {
            console.warn('[DeepLink] Navigation failed:', e);
          }
          return;
        }
        if (++attempts < 25) {
          setTimeout(tryNavigate, 150);
        } else {
          console.warn('[DeepLink] NavigationContainer never became ready');
        }
      };
      tryNavigate();
    };

    const handleUrl = (url: string) => {
      if (seen.has(url)) return;
      const result = handleDeepLink(url);
      if (!result) return;
      seen.add(url);
      navigateTo(result);
    };

    Linking.getInitialURL().then((url) => {
      if (url && !cancelled) handleUrl(url);
    });

    const sub = Linking.addEventListener('url', ({ url }) => {
      if (!cancelled) handleUrl(url);
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [navigationRef]);
};