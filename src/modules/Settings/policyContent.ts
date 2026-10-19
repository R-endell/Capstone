// src/modules/Settings/policyContent.ts
//
// DRAFT policy text for Pack-N-Ship. Written only from what the app and the
// capstone manuscript actually do. Items in [square brackets] are decisions the
// team still has to make. A qualified legal professional must review this text
// before it is shown to real users.

export const POLICY_VERSION = '0.1-draft';

export type PolicyId = 'terms' | 'privacy' | 'provider' | 'guidelines' | 'payments';

export interface PolicySection {
  heading: string;
  body: string[];
}

export interface Policy {
  id: PolicyId;
  title: string;
  icon: 'document-text-outline' | 'shield-checkmark-outline' | 'briefcase-outline' | 'people-outline' | 'wallet-outline';
  audience: 'everyone' | 'providers';
  sections: PolicySection[];
}

export const POLICIES: Policy[] = [
  {
    id: 'terms',
    title: 'Terms of Service',
    icon: 'document-text-outline',
    audience: 'everyone',
    sections: [
      {
        heading: 'What Pack-N-Ship is',
        body: [
          'Pack-N-Ship is a peer-to-peer delivery platform. Senders request deliveries, and verified Providers who travel common routes can accept them.',
          'Pack-N-Ship connects Senders and Providers. Providers are independent people, not employees of the platform.',
        ],
      },
      {
        heading: 'Your account',
        body: [
          'You must give accurate information when you register and keep it up to date.',
          'You are responsible for keeping your password private and for activity under your account.',
          'An administrator may deactivate an account that breaks these terms.',
        ],
      },
      {
        heading: 'Sending a package',
        body: [
          'Describe your package honestly, including its size and contents, and add accurate photos.',
          'Do not send items that are illegal or that the law does not allow to be transported.',
          'Each delivery has a tracking ID (PNS-XXXX). Use it when you contact support or report a problem.',
        ],
      },
      {
        heading: 'Problems and disputes',
        body: [
          'If something goes wrong, report it through the Dispute Center. The other party can respond, and an administrator reviews and decides.',
        ],
      },
      {
        heading: 'To be confirmed by the team',
        body: [
          '[Limits of liability for lost or damaged packages]',
          '[Governing law and where disputes are heard]',
          '[How and when these terms can change]',
        ],
      },
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy Notice',
    icon: 'shield-checkmark-outline',
    audience: 'everyone',
    sections: [
      {
        heading: 'What we collect',
        body: [
          'Account details: name, email address, phone number and, if you add one, a profile photo.',
          'Delivery details: pickup and drop-off locations, package details and photos, messages with the other party, and ratings.',
          'Location: your device location is used to show pickup and drop-off points. For Providers, it is shared with the Sender while a delivery is in progress.',
          'Provider verification: driver\'s license number and expiry date, photos of the license (front and back), and vehicle documents.',
          'Payments: payment details are handled by our payment processor. [Confirm exactly what Pack-N-Ship itself stores.]',
        ],
      },
      {
        heading: 'Why we use it',
        body: [
          'To create and secure your account, match deliveries, show tracking, process payments, verify Providers, and resolve disputes.',
        ],
      },
      {
        heading: 'Who can see it',
        body: [
          'Senders and Providers see what is needed for a delivery they share, such as names, locations and messages.',
          'Administrators can see Provider verification documents so they can approve or reject applications. They are not shown to other users.',
          'Your data is stored with our cloud database provider (Supabase).',
        ],
      },
      {
        heading: 'Your rights',
        body: [
          'Under the Philippine Data Privacy Act you may ask to access, correct or delete your personal data, and withdraw consent, subject to the law.',
          '[Contact email for privacy requests]',
          '[How long data and verification documents are kept]',
        ],
      },
    ],
  },
  {
    id: 'provider',
    title: 'Provider Agreement',
    icon: 'briefcase-outline',
    audience: 'providers',
    sections: [
      {
        heading: 'Becoming a Provider',
        body: [
          'You must hold a valid driver\'s license and submit accurate license details and photos.',
          'Your application is reviewed by an administrator, who may approve or reject it. You can accept deliveries only after approval.',
          'You may need to provide vehicle documents (OR/CR) as well.',
        ],
      },
      {
        heading: 'Delivering',
        body: [
          'Handle packages with care and deliver them to the agreed drop-off.',
          'Confirm pickup and drop-off using the QR code and PIN steps in the app.',
          'Keep your location sharing on while a delivery is in progress.',
        ],
      },
      {
        heading: 'Your responsibilities',
        body: [
          'Keep your license and vehicle documents valid, and update them when they expire.',
          'Respond to disputes raised against you through the Dispute Center.',
          'An administrator may deactivate a Provider account that breaks these terms.',
        ],
      },
      {
        heading: 'To be confirmed by the team',
        body: [
          '[Service fees and payout schedule]',
          '[Provider liability for lost or damaged packages]',
        ],
      },
    ],
  },
  {
    id: 'guidelines',
    title: 'Community Guidelines',
    icon: 'people-outline',
    audience: 'everyone',
    sections: [
      {
        heading: 'Be honest',
        body: [
          'Use your real details. Describe packages and deliveries accurately.',
          'Leave ratings and reviews that reflect your real experience.',
        ],
      },
      {
        heading: 'Be respectful',
        body: [
          'Communicate politely in chat. Harassment, threats and abuse are not allowed.',
        ],
      },
      {
        heading: 'Use the platform properly',
        body: [
          'Do not misuse tracking IDs, chat or the dispute system, and do not try to defraud other users.',
          'Report problems through the Dispute Center so an administrator can review them.',
        ],
      },
    ],
  },
  {
    id: 'payments',
    title: 'Payments, Escrow & Disputes',
    icon: 'wallet-outline',
    audience: 'everyone',
    sections: [
      {
        heading: 'How payment works',
        body: [
          'Payment for a delivery is held in escrow. It is released to the Provider after pickup and drop-off have been confirmed in the app.',
          'Providers can withdraw their earnings to a linked GCash account.',
        ],
      },
      {
        heading: 'If something goes wrong',
        body: [
          'Either side can open a dispute from the Dispute Center, using the delivery\'s tracking ID.',
          'The other party is notified and can respond once. An administrator reviews both sides and records a decision, and both are notified.',
        ],
      },
      {
        heading: 'To be confirmed by the team',
        body: [
          '[Refund rules and timelines]',
          '[Cancellation rules and any fees]',
        ],
      },
    ],
  },
];

export const getPolicy = (id: string): Policy | undefined => POLICIES.find((p) => p.id === id);