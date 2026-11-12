// src/components/terms/TermsGate.tsx
// Mount once inside the app (after UserProvider). When a signed-in user has no acceptance
// recorded for the CURRENT version of the Terms (a new user whose sign-up record failed, an
// account created before this feature, or any account after POLICY_VERSION changes), it shows
// the pop-up and does not let them dismiss it.
//
// If the check itself fails (offline, table missing) it stays quiet rather than lock people out.
import React, { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useUser } from '../../utils/userContext';
import { hasAcceptedCurrentVersion, recordTermsAcceptance } from '../../services/termsService';
import TermsModal from './TermsModal';

export default function TermsGate() {
  const { user, loading } = useUser();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (loading || !user?.user_id) { setShow(false); return; }
    (async () => {
      try {
        const ok = await hasAcceptedCurrentVersion();
        if (!cancelled) setShow(!ok);
      } catch (e) {
        if (!cancelled) setShow(false);
        console.warn('[TermsGate] check failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.user_id, loading]);

  const accept = async () => {
    try {
      setBusy(true);
      await recordTermsAcceptance('update');
      setShow(false);
    } catch (e: any) {
      Alert.alert("Couldn't save your agreement", e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <TermsModal
      visible={show}
      variant="general"
      title="We've updated our Terms and Policies"
      busy={busy}
      dismissible={false}
      onAccept={accept}
    />
  );
}