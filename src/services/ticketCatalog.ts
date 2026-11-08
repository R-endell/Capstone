// src/services/ticketCatalog.ts
// What a person can report, per role. Edit this file to add/rename issues;
// no database change is needed (the DB stores the labels as text).

export type Role = 'sender' | 'provider';
export type TicketType = 'dispute' | 'support';
export type LegacyIssueType = 'Lost' | 'Damaged' | 'Wrong item' | 'Not received' | 'Delayed' | 'Other';

export interface SubIssue {
  key: string;
  label: string;
  /** Mapped onto disputes.issue_type so the existing admin still understands it. */
  legacy?: LegacyIssueType;
}

export interface Category {
  key: string;
  label: string;
  blurb: string;
  icon: string; // Ionicons name
  /** 'dispute' involves the other party on the delivery; 'support' goes to the support team only. */
  type: TicketType;
  delivery: 'required' | 'optional' | 'none';
  /** Photos are most useful for this category. */
  photos: boolean;
  outcomes: string[];
  subIssues: SubIssue[];
}

const SENDER: Category[] = [
  {
    key: 'package', label: 'Problem with my package', icon: 'cube-outline',
    blurb: 'Damaged, lost, wrong or missing items',
    type: 'dispute', delivery: 'required', photos: true,
    outcomes: ['Refund', 'Redelivery or replacement', 'Compensation for the item', 'Just report it'],
    subIssues: [
      { key: 'damaged', label: 'Item arrived damaged', legacy: 'Damaged' },
      { key: 'lost', label: 'Item was lost', legacy: 'Lost' },
      { key: 'wrong', label: 'Wrong or missing items', legacy: 'Wrong item' },
      { key: 'not_received', label: 'Marked delivered, but not received', legacy: 'Not received' },
    ],
  },
  {
    key: 'timing', label: 'Late or no show', icon: 'time-outline',
    blurb: 'Late pickup or delivery, provider did not arrive',
    type: 'dispute', delivery: 'required', photos: false,
    outcomes: ['Refund', 'Reassign to another provider', 'Just report it'],
    subIssues: [
      { key: 'late_delivery', label: 'Delivered much later than expected', legacy: 'Delayed' },
      { key: 'late_pickup', label: 'Pickup was delayed', legacy: 'Delayed' },
      { key: 'no_show', label: 'Provider did not show up', legacy: 'Other' },
      { key: 'unresponsive', label: 'Provider stopped responding', legacy: 'Other' },
    ],
  },
  {
    key: 'conduct', label: 'Provider behavior', icon: 'person-outline',
    blurb: 'Rude, unsafe or unprofessional conduct',
    type: 'dispute', delivery: 'required', photos: false,
    outcomes: ['Warn the provider', 'Refund', 'Just report it'],
    subIssues: [
      { key: 'rude', label: 'Rude or disrespectful', legacy: 'Other' },
      { key: 'unsafe', label: 'Unsafe handling or driving', legacy: 'Other' },
      { key: 'extra_payment', label: 'Asked for extra payment', legacy: 'Other' },
    ],
  },
  {
    key: 'payment', label: 'Payment or charges', icon: 'card-outline',
    blurb: 'Wrong charge, refunds, failed payments',
    type: 'support', delivery: 'optional', photos: true,
    outcomes: ['Refund the difference', 'Explain the charge'],
    subIssues: [
      { key: 'wrong_charge', label: 'I was charged the wrong amount' },
      { key: 'refund_missing', label: 'My refund has not arrived' },
      { key: 'failed_paid', label: 'Payment failed but I was charged' },
      { key: 'payment_method', label: 'Problem with my payment method' },
    ],
  },
  {
    key: 'account', label: 'Account or app', icon: 'phone-portrait-outline',
    blurb: 'Verification, login, something is not working',
    type: 'support', delivery: 'none', photos: true,
    outcomes: [],
    subIssues: [
      { key: 'verification', label: 'Identity verification' },
      { key: 'login', label: 'Login or password' },
      { key: 'bug', label: 'The app is not working properly' },
      { key: 'other', label: 'Something else' },
    ],
  },
];

const PROVIDER: Category[] = [
  {
    key: 'sender', label: 'Problem with the sender', icon: 'people-outline',
    blurb: 'Unreachable, wrong details, package not as described',
    type: 'dispute', delivery: 'required', photos: true,
    outcomes: ['Adjust the fee', 'Warn the sender', 'Just report it'],
    subIssues: [
      { key: 'unreachable', label: 'Sender is not responding' },
      { key: 'wrong_details', label: 'Pickup or drop-off details were wrong' },
      { key: 'not_as_described', label: 'Package differs from what was booked (size or weight)' },
      { key: 'prohibited', label: 'Prohibited or unsafe item' },
      { key: 'rude', label: 'Rude or unsafe behavior' },
    ].map(s => ({ ...s, legacy: 'Other' as LegacyIssueType })),
  },
  {
    key: 'receiver', label: 'Problem at drop-off', icon: 'location-outline',
    blurb: 'Receiver unreachable or refused the package',
    type: 'dispute', delivery: 'required', photos: true,
    outcomes: ['Adjust the fee', 'Return the package', 'Just report it'],
    subIssues: [
      { key: 'receiver_unreachable', label: 'Receiver is unreachable' },
      { key: 'refused', label: 'Receiver refused the package' },
      { key: 'wrong_address', label: 'Address is wrong or does not exist' },
    ].map(s => ({ ...s, legacy: 'Other' as LegacyIssueType })),
  },
  {
    key: 'earnings', label: 'Earnings or cash-out', icon: 'cash-outline',
    blurb: 'Missing earnings, withdrawal problems',
    type: 'support', delivery: 'optional', photos: true,
    outcomes: ['Correct my earnings', 'Explain the amount'],
    subIssues: [
      { key: 'missing_earnings', label: 'Earnings are missing' },
      { key: 'wrong_amount', label: 'The amount looks wrong' },
      { key: 'cashout_failed', label: 'Withdrawal failed or is delayed' },
    ],
  },
  {
    key: 'vehicle', label: 'Vehicle, route or account', icon: 'car-outline',
    blurb: 'Verification, vehicle approval, routes, app problems',
    type: 'support', delivery: 'none', photos: true,
    outcomes: [],
    subIssues: [
      { key: 'verification', label: 'Provider verification' },
      { key: 'vehicle', label: 'Vehicle approval' },
      { key: 'route', label: 'Problem with my routes' },
      { key: 'bug', label: 'The app is not working properly' },
      { key: 'other', label: 'Something else' },
    ],
  },
];

export const CATEGORIES: Record<Role, Category[]> = { sender: SENDER, provider: PROVIDER };

/** Icon for a stored category label (tickets store the label as text). */
export const iconForCategory = (label: string): string => {
  for (const list of [SENDER, PROVIDER]) {
    const hit = list.find(c => c.label === label);
    if (hit) return hit.icon;
  }
  return 'help-circle-outline';
};