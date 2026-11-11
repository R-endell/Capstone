// src/modules/Settings/policyContent.ts
//
// DRAFT policy text for Pack-N-Ship. Written only from what the app and the
// capstone manuscript actually do. Items in [square brackets] are decisions the
// team still has to make. A qualified legal professional must review this text
// before it is shown to real users.
//
// Display rules (PolicyDetailScreen):
//   - a section with more than one line in `body` shows the lines as bullets
//   - a line written entirely inside [brackets] is shown as "to be confirmed"
//   - `rows` shows a small two-column card (label and value) under the body

export const POLICY_VERSION = '0.2-draft';

/** Most that can be claimed for an item, by package size. Used by the policy text and the payment screen. */
export const SIZE_LIMITS = [
  { label: 'Small', amount: 500 },
  { label: 'Medium', amount: 1000 },
  { label: 'Large', amount: 2000 },
];
const peso = (n: number) => `₱${n.toLocaleString('en-US')}`;

/** Only items worth less than this can be booked. Senders do not declare a value; booking confirms the item is under it. */
export const MAX_ITEM_VALUE = 5000;
/** Proposed Security Fund rate: percent of the delivery fee, charged to the Sender and to the Provider each. Confirm before launch. */
export const SECURITY_FUND_PERCENT = 3;
/** Hours allowed to report a problem after delivery is complete (damage) or after the expected delivery time (lost). */
export const REPORT_WINDOW_HOURS = { damaged: 24, lost: 48 };

export type PolicyId = 'terms' | 'privacy' | 'provider' | 'guidelines' | 'payments' | 'damage';

export interface PolicyRow {
  label: string;
  value: string;
}

export interface PolicySection {
  heading: string;
  body: string[];
  rows?: PolicyRow[];
}

export interface Policy {
  id: PolicyId;
  title: string;
  /** One short line shown under the title in the list. */
  summary: string;
  icon:
    | 'document-text-outline'
    | 'shield-checkmark-outline'
    | 'briefcase-outline'
    | 'people-outline'
    | 'wallet-outline'
    | 'cube-outline';
  audience: 'everyone' | 'providers';
  sections: PolicySection[];
}

export const POLICIES: Policy[] = [
  {
    id: 'terms',
    title: 'Terms of Service',
    summary: 'Accounts, sending packages and reporting problems',
    icon: 'document-text-outline',
    audience: 'everyone',
    sections: [
      {
        heading: 'What Pack-N-Ship is',
        body: [
          'Pack-N-Ship is a technology platform that connects Senders who need a package delivered with independent, verified Providers who are already travelling along a route.',
          'Pack-N-Ship is not a courier, carrier or delivery company. We do not take possession of, transport or deliver any package. The Provider carries out the delivery.',
          'Pack-N-Ship does not own, insure or guarantee packages. If something goes wrong, we help both sides settle it fairly, using the evidence in the app.',
        ],
      },
      {
        heading: 'Your account',
        body: [
          'You must give accurate information when you register and keep it up to date.',
          'You are responsible for keeping your password private and for activity under your account.',
          'All users must follow the laws of the Philippines when using Pack-N-Ship.',
        ],
      },
      {
        heading: 'Sending a package',
        body: [
          'Describe your package honestly, including its contents, and add accurate photos.',
          'Choose the correct package size. A package larger or heavier than the size you chose may be refused at pickup, and you remain responsible for any resulting cost.',
          `Only items worth less than ${peso(MAX_ITEM_VALUE)} can be sent through Pack-N-Ship. You do not enter a value for your package. By confirming a booking, you confirm the item is within this limit.`,
          'Do not send items that are illegal, hazardous or that the law does not allow to be transported.',
          'Each delivery has a tracking ID. Use it when you contact support or report a problem.',
        ],
      },
      {
        heading: 'Photo evidence',
        body: [
          'Clear photos of the package are required at pickup and at drop-off. Each photo carries an automatic date and time.',
          'Photos should be taken in the app so the date and time can be verified. A pickup or drop-off cannot be completed without them.',
          'If photos are missing, unclear or edited, Pack-N-Ship may decide a case against the person who did not provide them.',
        ],
      },
      {
        heading: 'Problems and disputes',
        body: [
          'If something goes wrong, open Help and tap Report a problem. The other party can respond, and an administrator reviews and decides.',
          `Report a damaged package within ${REPORT_WINDOW_HOURS.damaged} hours after the delivery is complete, and a lost or undelivered package within ${REPORT_WINDOW_HOURS.lost} hours after the expected delivery time. Late reports may be declined.`,
          'Damaged or lost packages are handled under the Package Damage and Responsibility Policy.',
        ],
      },
      {
        heading: 'Security Fund',
        body: [
          `A small Security Fund contribution of [${SECURITY_FUND_PERCENT}%] of the delivery fee is collected from the Sender and from the Provider on each delivery.`,
          'The fund helps cover genuine events outside anyone\'s control, such as a road accident, so that the platform stays sustainable.',
          'The Security Fund is not insurance and does not guarantee compensation. See the Package Damage and Responsibility Policy.',
        ],
      },
      {
        heading: 'Limits of liability',
        body: [
          'Pack-N-Ship provides a platform that connects Senders and Providers. We do not carry packages ourselves.',
          'To the extent the law allows, Pack-N-Ship is not responsible for loss or damage to packages, or for what a Sender, Provider or Receiver does or does not do. Responsibility between users is handled under the Package Damage and Responsibility Policy.',
          'Nothing in these terms takes away a right you have under Philippine law that cannot be waived.',
        ],
      },
      {
        heading: 'Suspension and ending your account',
        body: [
          'You can stop using Pack-N-Ship at any time.',
          'We have the right to suspend or deactivate an account for fraud, such as false information, fake or altered photos, false claims, or forged identity or license documents. We may also act on unsafe behavior, harassment or repeated violations of these terms.',
          'Pending payouts may be held while a case is under review, and unlawful conduct may be reported to the proper authorities.',
          'You can appeal a deactivation from Help within [10 days].',
          'Amounts owed for a confirmed claim remain payable after an account is closed.',
        ],
      },
      {
        heading: 'Governing law',
        body: [
          'These terms are governed by the laws of the Philippines. Disputes that cannot be solved in the app are heard by the courts of the city where Pack-N-Ship operates.',
        ],
      },
      {
        heading: 'To be confirmed by the team',
        body: [
          '[City whose courts hear disputes]',
          '[How and when these terms can change]',
          '[Counsel to confirm the Security Fund is not treated as insurance]',
          '[Counsel to confirm how the Internet Transactions Act and the Consumer Act apply to the platform]',
        ],
      },
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy Notice',
    summary: 'What we collect, why, and your rights',
    icon: 'shield-checkmark-outline',
    audience: 'everyone',
    sections: [
      {
        heading: 'What we collect',
        body: [
          'Account details: name, email address, phone number and, if you add one, a profile photo.',
          'Delivery details: pickup and drop-off locations, package details and photos, messages with the other party, and ratings.',
          'Location: your device location is used to show pickup and drop-off points. For Providers, it is shared with the Sender while a delivery is in progress.',
          "Provider verification: driver's license number and expiry date, photos of the license (front and back), and vehicle documents.",
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
          'Pickup and drop-off photos, with their date and time, are stored securely and used only to verify deliveries, resolve disputes and meet legal duties.',
          'Photos and messages you send with a report are visible only to you and the support team, apart from the original report, which the other party on that delivery also sees.',
          'Your data is stored with our cloud database provider (Supabase).',
        ],
      },
      {
        heading: 'Your rights',
        body: [
          'Pack-N-Ship handles personal data in line with the Data Privacy Act of 2012 (Republic Act No. 10173). We collect only what is needed to run the service, keep it secure and do not sell it.',
          'You may ask to access, correct or delete your personal data, and withdraw consent, subject to the law.',
          '[Contact email for privacy requests]',
          '[How long data and verification documents are kept]',
        ],
      },
    ],
  },
  {
    id: 'provider',
    title: 'Provider Agreement',
    summary: 'Rules for people who deliver packages',
    icon: 'briefcase-outline',
    audience: 'providers',
    sections: [
      {
        heading: 'Becoming a Provider',
        body: [
          "You must hold a valid driver's license and submit accurate license details and photos.",
          'Your application is reviewed by an administrator, who may approve or reject it. You can accept deliveries only after approval.',
          'You may need to provide vehicle documents (OR/CR) as well.',
        ],
      },
      {
        heading: 'Delivering',
        body: [
          'Handle packages with care and deliver them to the agreed drop-off.',
          'Confirm pickup and drop-off using the QR code and PIN steps in the app.',
          'Take a clear photo of the package at pickup and another at drop-off, every time, in the app so the date and time are recorded. A pickup or drop-off cannot be completed without them, and they protect you if a claim is made.',
          `Do not carry prohibited items, or items worth ${peso(MAX_ITEM_VALUE)} or more. You may refuse a package you reasonably believe is unsafe, prohibited or not as described.`,
          'Keep your location sharing on while a delivery is in progress.',
          'If the receiver cannot be reached at drop-off, wait 5 minutes, then return the package to the Sender and report it in the app.',
          'Do not skip a pickup you accepted. A no-show earns you a strike.',
        ],
      },
      {
        heading: 'Your responsibilities',
        body: [
          'Keep your license and vehicle documents valid, and update them when they expire.',
          'Respond to reports raised against you. Open Help to see reports that need your answer.',
          'If a package is damaged or lost while in your care, the Package Damage and Responsibility Policy applies. If you are found at fault, you may be asked to cover a share of the loss from your earnings. You are never asked to pay for damage you did not cause.',
          `A Security Fund contribution of [${SECURITY_FUND_PERCENT}%] of the delivery fee applies to each delivery you carry. It is shown before you accept a trip and is not refundable once the delivery starts.`,
          'Pack-N-Ship may deactivate a Provider account for fraud, including fake or altered evidence or forged documents, or for breaking these terms.',
        ],
      },
      {
        heading: 'Strikes',
        body: [
          'Confirmed problems such as no-shows, damage caused by your handling, or unsafe behavior earn a strike. Accidents outside your control do not.',
          'Strike 1: a warning. Strike 2: a temporary suspension. Strike 3: removal from the platform.',
          'Serious cases, such as theft, fraud or hiding damage, lead to removal right away.',
        ],
      },
      {
        heading: 'Service fee and earnings',
        body: [
          'Pack-N-Ship keeps a service fee of [15%] of the delivery fare. The rest is your earnings.',
          'Your earnings are released after pickup and drop-off are confirmed, and you can withdraw them to a linked GCash account.',
          '[Payout schedule and minimum withdrawal]',
        ],
      },
    ],
  },
  {
    id: 'guidelines',
    title: 'Community Guidelines',
    summary: 'How we expect everyone to behave',
    icon: 'people-outline',
    audience: 'everyone',
    sections: [
      {
        heading: 'Be honest',
        body: [
          'Use your real details. Describe packages and deliveries accurately.',
          'Leave ratings and reviews that reflect your real experience.',
          'Never upload fake, edited or reused photos or documents. Fraud can lead to your account being deactivated.',
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
          'Do not misuse tracking IDs, chat, live support or the report system, and do not try to defraud other users.',
          'Report problems through Help so an administrator can review them.',
        ],
      },
    ],
  },
  {
    id: 'payments',
    title: 'Payments, Escrow & Disputes',
    summary: 'Escrow, payouts and how problems are decided',
    icon: 'wallet-outline',
    audience: 'everyone',
    sections: [
      {
        heading: 'How payment works',
        body: [
          'Payment for a delivery is held in escrow. It is released to the Provider after pickup and drop-off have been confirmed in the app.',
          'Providers can withdraw their earnings to a linked GCash account.',
          '[Earnings become available to withdraw 48 hours after drop-off, so any damage claim can be settled first.]',
          `A Security Fund contribution of [${SECURITY_FUND_PERCENT}%] of the delivery fee is collected from the Sender and from the Provider. It is shown before you book or accept a trip.`,
        ],
      },
      {
        heading: 'If something goes wrong',
        body: [
          "Either side can report a problem from Help, using the delivery's tracking ID.",
          'The other party is notified and can respond once. An administrator reviews both sides and records a decision, and both are notified.',
          'You can also chat with our support team from Help using the Live chat icon.',
        ],
      },
      {
        heading: 'If a Provider does not show up',
        body: [
          'You are refunded in full and your request is matched to another Provider. The Provider who did not show up receives a strike.',
        ],
      },
      {
        heading: 'Cancelling a delivery',
        body: [
          'You can cancel for free until the Provider confirms pickup by scanning the QR code.',
          '[What happens if you want to cancel after pickup is confirmed]',
        ],
      },
      {
        heading: 'If the receiver cannot be reached',
        body: [
          'The Provider waits 5 minutes at the drop-off, then returns the package to the Sender and reports it in the app.',
          '[Who pays for the return trip]',
        ],
      },
      {
        heading: 'To be confirmed by the team',
        body: [
          '[Refund timeline for cancelled deliveries]',
        ],
      },
    ],
  },
  {
    id: 'damage',
    title: 'Package Damage and Responsibility Policy',
    summary: 'Who is responsible if a package is damaged or lost',
    icon: 'cube-outline',
    audience: 'everyone',
    sections: [
      {
        heading: 'Our role',
        body: [
          'Most deliveries go smoothly. This policy is here so both Senders and Providers know what to expect if one does not.',
          'Pack-N-Ship is a platform that connects Senders with independent Providers. We are not the carrier, and we do not own, insure or guarantee any package. To the extent the law allows, Pack-N-Ship is not liable for damaged or lost items.',
          'What we do provide: photo records, QR and PIN handover, tracking, held payments, and a fair, evidence-based review of every report.',
        ],
      },
      {
        heading: 'How responsibility is shared',
        body: [
          'We look at the evidence, not at who reports first. A Provider is responsible for a package that is damaged or lost while in their care if this is proven, and a Sender is equally responsible if the problem is proven to come from the Sender\'s side.',
        ],
        rows: [
          {
            label: 'Clear sign the Provider caused it',
            value: 'Provider covers [100%] of the item value, up to the limit for the package size.',
          },
          {
            label: 'Cannot be shown who caused it',
            value: 'Shared equally: [50%] Provider, [50%] Sender.',
          },
          {
            label: 'Caused by packing, an unmarked fragile item, a wrong size, or damage that was already there at pickup',
            value: 'Sender covers 100%, including any damage the package causes to the Provider\'s vehicle or belongings. No claim against the Provider.',
          },
          {
            label: 'Outside anyone\'s control, such as an accident caused by another vehicle',
            value: '[Paid from the Security Fund, up to the limit for the package size, while the fund has enough.] The Provider receives no strike.',
          },
          {
            label: 'Prohibited item, or an item worth ₱5,000 or more',
            value: 'No compensation.',
          },
        ],
      },
      {
        heading: 'Compensation limits',
        body: [
          'To keep things fair for everyone, the most that can be claimed depends on the package size. This is the most that is counted before the shares above are applied.',
          'Compensation is based on the item\'s real worth at the time, shown by a receipt, order confirmation or screenshot. It is never more than the proven value, and not more than the limit.',
          `Only items worth less than ${peso(MAX_ITEM_VALUE)} can be booked. Senders do not declare a value, and items at or above this amount are not covered.`,
        ],
        rows: [
          ...SIZE_LIMITS.map(l => ({ label: `${l.label} package`, value: `Up to ${peso(l.amount)}` })),
        ],
      },
      {
        heading: 'Your agreement at booking',
        body: [
          'When you book, you are asked to confirm that you have read the limits in this policy. Tapping Agree means you accept them for that delivery.',
          'Providers accept this policy when they join, and again in the Provider Agreement.',
        ],
      },
      {
        heading: 'Security Fund',
        body: [
          `Each delivery includes a small Security Fund contribution of [${SECURITY_FUND_PERCENT}%] of the delivery fee from the Sender and from the Provider. It is shown before you book or accept a trip.`,
          'The fund helps pay for events outside anyone\'s control, such as a road accident. Payouts are decided on proof and are never more than the limits above.',
          'Contributions are not refundable once the delivery starts. The Security Fund is not insurance and does not guarantee compensation.',
        ],
      },
      {
        heading: 'Who pays and how',
        body: [
          'Pack-N-Ship does not pay for items from its own money. We help collect each side\'s share and pass it on.',
          'The Provider\'s share is taken first from the earnings held for that delivery, then from up to [50%] of their future earnings until it is paid.',
          'When the Provider is found at fault, the delivery fee is also returned to the Sender from the held payment.',
          'If the Provider cannot pay their whole share, the Sender receives what is collected and the case is closed.',
          'Both sides can also agree on a settlement themselves. If they do, tell us in the report and we will close the case.',
        ],
      },
      {
        heading: 'What can be claimed',
        body: [
          "Damage caused by the Provider's handling, driving or storage of the package.",
          'A package lost after the Provider accepted it.',
          'A package marked delivered that the receiver did not get, when the handover records do not support the delivery.',
        ],
      },
      {
        heading: 'What cannot be claimed',
        body: [
          'Damage from poor packing, or fragile items that were not marked as fragile.',
          'Damage that already existed before pickup, as shown in the pickup photos.',
          'Prohibited items, such as weapons, illegal drugs, explosives, flammable or hazardous goods, live animals, cash and similar valuables, or anything illegal in the Philippines.',
          `Items worth ${peso(MAX_ITEM_VALUE)} or more.`,
          'Items that differ from what was booked.',
          'Late delivery caused by events outside anyone\'s control, such as severe weather or road closures.',
          'Indirect losses, such as lost business or the cost of a missed event.',
        ],
      },
      {
        heading: 'Sender responsibilities',
        body: [
          'Pack the item safely and describe it accurately, with clear photos when you book.',
          'Mark fragile items and choose the correct package size.',
          'Check the package on delivery and report problems quickly.',
        ],
      },
      {
        heading: 'Provider responsibilities',
        body: [
          'Handle the package with care from pickup to handover.',
          'Take a pickup photo and a drop-off photo in the app every time, and complete the QR and PIN steps.',
          'Report any accident, damage or problem right away in the app.',
          'Never open, replace or keep a package.',
        ],
      },
      {
        heading: 'Pickup and drop-off photos',
        body: [
          'Clear photos of the package and its packaging are required at pickup and at drop-off, so its condition is on record both times.',
          'Every photo carries an automatic date and time. Take them in the app so these can be verified.',
          'A pickup or drop-off cannot be completed without the photos. If they are missing, unclear or edited, we may decide against the person who did not provide them.',
        ],
      },
      {
        heading: 'Evidence we look at',
        body: [
          "The Sender's booking photos and package description.",
          "The Provider's pickup and drop-off photos, and the QR and PIN handover records.",
          'Proof of the item value, such as a receipt, order confirmation or screenshot.',
          'Reports, messages and photos in the app, and location records during the delivery.',
          'A claim without enough evidence may be reduced or denied.',
        ],
      },
      {
        heading: 'Keeping claims honest and fair',
        body: [
          'Only one claim can be made per delivery, and it must match what was booked.',
          'Photos from the booking, pickup and drop-off are compared with the claim photos.',
          'Many claims in a short time [more than 3 in 30 days] are reviewed more closely, for both Senders and Providers.',
          'False claims, edited photos or fake receipts lead to a denied claim. Pack-N-Ship has the right to deactivate the account of anyone who commits fraud.',
          'Providers are never asked to pay more than their share, or more than the limits above.',
        ],
      },
      {
        heading: 'How to file a claim',
        body: [
          'Open Help, tap Report a problem, and choose the delivery. You can search by delivery ID.',
          'Select Problem with my package, describe what happened, add clear photos, and choose the outcome you want.',
          `File within ${REPORT_WINDOW_HOURS.damaged} hours after the delivery is marked complete for a damaged package, or within ${REPORT_WINDOW_HOURS.lost} hours after the expected delivery time for a lost or undelivered one. Late reports may be declined.`,
          'The other side is notified and can explain their side once. Our team then reviews both sides.',
        ],
      },
      {
        heading: 'How we decide',
        body: [
          'Our team reviews the evidence from both sides and decides how responsibility is shared. The decision appears in the report and both sides are notified.',
          'Money that is owed is returned to the Sender\'s original payment method or in-app wallet within [7 business days] of collection.',
        ],
      },
      {
        heading: 'Strikes for Providers',
        body: [
          'A strike is given only when the Provider is found at fault, not for accidents outside their control.',
          'Strike 1: a warning. Strike 2: a temporary suspension. Strike 3: removal from the platform.',
          'Theft, fraud or hiding damage leads to removal right away, and possible legal action.',
        ],
      },
      {
        heading: 'Appeals',
        body: [
          'Either side can appeal a decision once, within [5 to 7 business days]. Open the report in Help and tap Appeal this decision. Add new details or photos if you have them.',
          'Our team reviews the appeal and its result is final. An appeal cannot be appealed again.',
        ],
      },
      {
        heading: 'Your legal rights',
        body: [
          'This policy does not take away any right you have under Philippine law that cannot be waived, including your consumer rights.',
          'If any part of this policy is found to be unenforceable, the rest still applies.',
          '[Counsel to confirm how Philippine laws on carriers and consumers apply to this policy]',
        ],
      },
      {
        heading: 'Changes to this policy',
        body: [
          'Pack-N-Ship may update this policy. Changes apply to deliveries booked after the update, and users will be told in the app.',
        ],
      },
    ],
  },
];

export const getPolicy = (id: string): Policy | undefined => POLICIES.find((p) => p.id === id);