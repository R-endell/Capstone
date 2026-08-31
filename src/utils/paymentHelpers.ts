export const PAYMENT_METHOD_INFO = {
  gcash: {
    label: 'GCash',
    image: require('../../assets/gcash.png'),
    color: '#007DFE',
    description: 'Mobile Wallet',
  },
  paymaya: {
    label: 'Maya',
    image: require('../../assets/maya.jpeg'),
    color: '#6C27B0',
    description: 'Digital Wallet',
  },
  card: {
    label: 'Credit/Debit Card',
    icon: '💳',
    color: '#1A1A1A',
    description: 'Visa, Mastercard, etc.',
  },
  online_banking: {
    label: 'Online Banking',
    icon: '🏦',
    color: '#1E3A5F',
    description: 'Bank transfer / payment',
  },
} as const;