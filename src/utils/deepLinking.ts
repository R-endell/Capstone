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

  // ---- Payment callback (preserved from original) ----
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

  // ---- EMAIL VERIFICATION (NEW) ----
  if (isMatch('auth/confirm')) {
    const token_hash =
      typeof queryParams.token_hash === 'string' ? queryParams.token_hash : undefined;
    const type = typeof queryParams.type === 'string' ? queryParams.type : 'signup';

    if (!token_hash) {
      console.warn('[DeepLink] auth/confirm missing token_hash');
      return null;
    }

    return {
      route: 'VerifyEmail',
      params: { token_hash, type },
    };
  }

  return null;
};

/**
 * Listens for deep links (cold + warm start). Uses `reset` so the deep link
 * fully takes over the stack — this is what prevents the Loading screen's
 * timer from kicking the user back to Login during the reset flow.
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