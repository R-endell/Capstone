import { useEffect } from 'react';
import * as Linking from 'expo-linking';

export const handleDeepLink = (url: string) => {
  const { path, queryParams } = Linking.parse(url);

  if (path === 'payment/callback') {
    // Handle payment callback
    const params = (queryParams ?? {}) as Record<string, string | string[] | undefined>;
    const { payment_method_id, status } = params;

    // Navigate to payment result screen
    return {
      route: 'PaymentResult',
      params: { payment_method_id, status },
    };
  }

  return null;
};

export const useDeepLink = () => {
  const handleUrl = (url: string) => {
    const result = handleDeepLink(url);
    if (result) {
      // Navigate using your navigation
      // navigation.navigate(result.route, result.params);
    }
  };

  useEffect(() => {
    // Handle initial URL
    Linking.getInitialURL().then((url) => {
      if (url) handleUrl(url);
    });

    // Listen for URL changes
    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleUrl(url);
    });

    return () => subscription.remove();
  }, []);
};