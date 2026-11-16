// src/components/ProofOfDeliveryModal.tsx
//
// The "Package Delivered!" pop-up on the sender's side has been removed.
// The proof of delivery photo and completion details are still shown inside the
// delivery's detail view in the Activity > Completed tab.
//
// The component and its props are kept so existing imports/usages
// (<ProofOfDeliveryModal isSenderMode={...} onViewDetails={...} />) keep compiling,
// but it no longer subscribes to realtime updates, queries Supabase, or renders anything.
// `pod_seen_by_sender` is intentionally left untouched so nothing else that reads it changes.
import React from 'react';

export default function ProofOfDeliveryModal(
  _props: {
    isSenderMode: boolean;
    onViewDetails?: (requestId: number) => void;
  },
) {
  return null;
}