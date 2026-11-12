// src/components/NetworkStatusModal.tsx
// Global "No internet connection" modal. Mounted once in App.tsx so it shows on every screen.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../utils/themeContext';

// Wait a moment before showing the modal so brief signal blips don't cause flicker.
const SHOW_DELAY_MS = 1500;

const isOffline = (s: NetInfoState) => s.isConnected === false || s.isInternetReachable === false;

export default function NetworkStatusModal() {
  const { colors, isDark } = useTheme();
  const [offline, setOffline] = useState(false);
  const [checking, setChecking] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleState = useCallback((state: NetInfoState) => {
    if (isOffline(state)) {
      if (!timerRef.current) {
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          setOffline(true);
        }, SHOW_DELAY_MS);
      }
    } else {
      // Back online (or still unknown): cancel any pending show and hide immediately.
      clearTimer();
      setOffline(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(handleState);
    NetInfo.fetch().then(handleState).catch(() => {});
    return () => {
      unsubscribe();
      clearTimer();
    };
  }, [handleState]);

  const retry = async () => {
    setChecking(true);
    try {
      const state = await NetInfo.refresh();
      if (!isOffline(state)) {
        clearTimer();
        setOffline(false);
      }
    } catch {
      /* stay on the modal */
    } finally {
      setTimeout(() => setChecking(false), 600);
    }
  };

  const border = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';

  return (
    <Modal visible={offline} transparent animationType="fade" statusBarTranslucent onRequestClose={() => { /* not dismissible */ }}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: border }]}>
          <View style={[styles.iconWrap, { backgroundColor: colors.errorBg }]}>
            <Ionicons name="cloud-offline-outline" size={34} color={colors.error} />
          </View>
          <Text style={[styles.title, { color: colors.textPrimary }]}>No Internet Connection</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            You're disconnected from the internet. Please check your Wi-Fi or mobile data. This will close automatically once you're back online.
          </Text>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: colors.accent }, checking && { opacity: 0.7 }]}
            onPress={retry}
            disabled={checking}
            activeOpacity={0.9}
          >
            {checking ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="refresh" size={16} color="#FFFFFF" />
                <Text style={styles.btnText}>Try again</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 360, borderRadius: 20, borderWidth: 1, padding: 24, alignItems: 'center' },
  iconWrap: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title: { fontSize: 18, fontFamily: 'Poppins_700Bold', letterSpacing: -0.2, textAlign: 'center' },
  body: { fontSize: 14, lineHeight: 20, fontFamily: 'Poppins_400Regular', textAlign: 'center', marginTop: 8, marginBottom: 20 },
  btn: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12 },
  btnText: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Poppins_700Bold' },
});