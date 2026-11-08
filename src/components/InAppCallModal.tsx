// src/components/InAppCallModal.tsx
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, StatusBar,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useCameraPermissions } from 'expo-camera';
import { supabase } from '../utils/supabase';
import { onOutgoingCall, updateCallStatus } from '../services/callService';
import { useTheme, ThemeColors } from '../utils/themeContext';
import { SolarIcon } from './ui/SolarIcon';

const WEBRTC_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="background:#111827;margin:0;padding:0;">
  <audio id="remoteAudio" autoplay playsinline></audio>
  <script>
    let pc = null;
    let localStream = null;
    const remoteAudio = document.getElementById('remoteAudio');

    function initPeerConnection() {
      if (pc) return;
      pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ICE', candidate: e.candidate }));
        }
      };

      pc.ontrack = (e) => {
        if (e.streams && e.streams[0]) {
          remoteAudio.srcObject = e.streams[0];
          remoteAudio.play().catch(err => console.log("Play error:", err));
        }
      };
    }

    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then((stream) => {
        localStream = stream;
        initPeerConnection();
        stream.getTracks().forEach(t => pc.addTrack(t, stream));
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'READY' }));
      })
      .catch((err) => {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ERROR', message: err.message }));
      });

    window.createOffer = async () => {
      try {
        initPeerConnection();
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'OFFER', sdp: offer }));
      } catch (e) {
        console.log("Create offer error:", e);
      }
    };

    window.receiveOffer = async (offer) => {
      try {
        initPeerConnection();
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ANSWER', sdp: answer }));
      } catch (e) {
        console.log("Receive offer error:", e);
      }
    };

    window.receiveAnswer = async (answer) => {
      try {
        if (pc && !pc.currentRemoteDescription) {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
        }
      } catch (e) {
        console.log("Receive answer error:", e);
      }
    };

    window.addIce = async (candidate) => {
      try {
        if (pc) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (e) {
        console.log("Add ICE error:", e);
      }
    };

    window.setMuted = (muted) => {
      if (localStream) {
        localStream.getAudioTracks().forEach(t => { t.enabled = !muted; });
      }
    };
  </script>
</body>
</html>
`;

export default function InAppCallModal() {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [activeCall, setActiveCall] = useState<any | null>(null);
  const [isIncoming, setIsIncoming] = useState(false);
  const [callState, setCallState] = useState<'ringing' | 'connected'>('ringing');
  const [otherUser, setOtherUser] = useState<{ name: string; role: string }>({
    name: 'Pack-N-Ship User',
    role: 'Voice Call',
  });
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  const webViewRef = useRef<any>(null);
  const timerRef = useRef<any>(null);
  const sigChannelRef = useRef<any>(null);
  const webViewReadyRef = useRef(false);
  const [, requestPermission] = useCameraPermissions();

  const startTimer = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setInterval(() => {
      setDuration(prev => prev + 1);
    }, 1000);
  }, []);

  const cleanupCall = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (sigChannelRef.current) {
      supabase.removeChannel(sigChannelRef.current);
      sigChannelRef.current = null;
    }
    webViewReadyRef.current = false;
    setActiveCall(null);
    setIsIncoming(false);
    setCallState('ringing');
    setDuration(0);
    setIsMuted(false);
  }, []);

  useEffect(() => {
    let mounted = true;
    const resolveUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        if (mounted) setCurrentUserId(null);
        return;
      }
      const { data: uRow } = await supabase
        .from('users')
        .select('user_id')
        .eq('auth_id', session.user.id)
        .maybeSingle();
      if (mounted && uRow?.user_id) setCurrentUserId(uRow.user_id);
    };
    resolveUser();

    const { data: sub } = supabase.auth.onAuthStateChange(() => resolveUser());
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const unsub = onOutgoingCall((session, calleeName, roleLabel) => {
      requestPermission().catch(() => {});
      setActiveCall(session);
      setIsIncoming(false);
      setCallState('ringing');
      setOtherUser({ name: calleeName, role: roleLabel });
    });
    return unsub;
  }, [requestPermission]);

  useEffect(() => {
    if (!currentUserId) return;

    const channel = supabase
      .channel(`incoming-calls-${currentUserId}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'call_sessions',
          filter: `callee_id=eq.${currentUserId}`,
        },
        async (payload) => {
          const row = payload.new as any;
          if (row.status !== 'ringing') return;
          requestPermission().catch(() => {});
          setActiveCall(row);
          setIsIncoming(true);
          setCallState('ringing');

          const { data: caller } = await supabase
            .from('users')
            .select('first_name, last_name')
            .eq('user_id', row.caller_id)
            .maybeSingle();

          const callerName = caller
            ? `${caller.first_name || ''} ${caller.last_name || ''}`.trim() || 'Pack-N-Ship User'
            : 'Pack-N-Ship User';
          setOtherUser({ name: callerName, role: 'Incoming Voice Call' });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, requestPermission]);

  useEffect(() => {
    if (!activeCall?.call_id) return;

    const callId = activeCall.call_id;
    const channel = supabase
      .channel(`webrtc-room-${callId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'call_sessions',
          filter: `call_id=eq.${callId}`,
        },
        (payload) => {
          const updated = payload.new as any;
          if (updated.status === 'active') {
            setCallState('connected');
            startTimer();
            if (!isIncoming && webViewReadyRef.current) {
              webViewRef.current?.injectJavaScript('window.createOffer && window.createOffer(); true;');
            }
          } else if (updated.status === 'ended' || updated.status === 'rejected') {
            cleanupCall();
          }
        }
      )
      .on('broadcast', { event: 'webrtc-signal' }, ({ payload }) => {
        if (!payload || payload.senderId === currentUserId) return;
        if (payload.type === 'OFFER') {
          webViewRef.current?.injectJavaScript(
            `window.receiveOffer && window.receiveOffer(${JSON.stringify(payload.sdp)}); true;`
          );
        } else if (payload.type === 'ANSWER') {
          webViewRef.current?.injectJavaScript(
            `window.receiveAnswer && window.receiveAnswer(${JSON.stringify(payload.sdp)}); true;`
          );
        } else if (payload.type === 'ICE') {
          webViewRef.current?.injectJavaScript(
            `window.addIce && window.addIce(${JSON.stringify(payload.candidate)}); true;`
          );
        }
      })
      .subscribe();

    sigChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      sigChannelRef.current = null;
    };
  }, [activeCall?.call_id, currentUserId, isIncoming, startTimer, cleanupCall]);

  const handleAccept = async () => {
    if (!activeCall) return;
    setIsIncoming(false);
    setCallState('connected');
    startTimer();
    await updateCallStatus(activeCall.call_id, 'active');
  };

  const handleReject = async () => {
    if (!activeCall) return;
    await updateCallStatus(activeCall.call_id, 'rejected');
    cleanupCall();
  };

  const handleHangUp = async () => {
    if (!activeCall) return;
    await updateCallStatus(activeCall.call_id, 'ended');
    cleanupCall();
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  if (!activeCall) return null;

  const initials = otherUser.name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase() || 'U';

  return (
    <Modal visible transparent animationType="slide" onRequestClose={handleHangUp}>
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={colors.background} />

        <View style={{ width: 1, height: 1, opacity: 0 }}>
          <WebView
            ref={webViewRef}
            source={{ html: WEBRTC_HTML, baseUrl: 'https://packnship.app' }}
            originWhitelist={['*']}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            domStorageEnabled
            onPermissionRequest={(event: any) => {
              event?.nativeEvent?.resources && event.nativeEvent.grant(event.nativeEvent.resources);
            }}
            onMessage={(e) => {
              try {
                const msg = JSON.parse(e.nativeEvent.data);
                if (msg.type === 'READY') {
                  webViewReadyRef.current = true;
                  if (callState === 'connected' && !isIncoming) {
                    webViewRef.current?.injectJavaScript('window.createOffer && window.createOffer(); true;');
                  }
                } else if (
                  (msg.type === 'OFFER' || msg.type === 'ANSWER' || msg.type === 'ICE') &&
                  sigChannelRef.current
                ) {
                  sigChannelRef.current.send({
                    type: 'broadcast',
                    event: 'webrtc-signal',
                    payload: { ...msg, senderId: currentUserId },
                  });
                }
              } catch {}
            }}
          />
        </View>

        <View style={styles.content}>
          <View style={styles.rolePill}>
            <SolarIcon name="ShieldCheck" variant="linear" size={14} color={colors.accent} />
            <Text style={styles.rolePillText}>PACK-N-SHIP IN-APP CALL</Text>
          </View>

          <View style={styles.avatarRing}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
          </View>

          <Text style={styles.nameText}>{otherUser.name}</Text>
          <Text style={styles.roleSubText}>{otherUser.role}</Text>
          <Text style={styles.statusText}>
            {callState === 'ringing'
              ? isIncoming
                ? 'Incoming Voice Call...'
                : 'Calling...'
              : formatTime(duration)}
          </Text>

          {isIncoming && callState === 'ringing' ? (
            <View style={styles.actionRow}>
              <View style={styles.btnCol}>
                <TouchableOpacity
                  style={[styles.callBtn, { backgroundColor: colors.error }]}
                  onPress={handleReject}
                  activeOpacity={0.85}
                >
                  <SolarIcon name="Phone" variant="bold" size={30} color="#FFF" style={{ transform: [{ rotate: '135deg' }] }} />
                </TouchableOpacity>
                <Text style={styles.btnCaption}>Decline</Text>
              </View>

              <View style={styles.btnCol}>
                <TouchableOpacity
                  style={[styles.callBtn, { backgroundColor: colors.success }]}
                  onPress={handleAccept}
                  activeOpacity={0.85}
                >
                  <SolarIcon name="Phone" variant="bold" size={30} color="#FFF" />
                </TouchableOpacity>
                <Text style={styles.btnCaption}>Accept</Text>
              </View>
            </View>
          ) : (
            <View style={styles.activeControlsRow}>
              <View style={styles.btnCol}>
                <TouchableOpacity
                  style={[styles.controlButton, isMuted && styles.controlActive]}
                  onPress={() => {
                    const next = !isMuted;
                    setIsMuted(next);
                    webViewRef.current?.injectJavaScript(`window.setMuted && window.setMuted(${next}); true;`);
                  }}
                  activeOpacity={0.85}
                >
                  <SolarIcon name={isMuted ? 'MicrophoneSlash' : 'Microphone'} variant="bold" size={26} color="#FFF" />
                </TouchableOpacity>
                <Text style={styles.btnCaption}>{isMuted ? 'Unmute' : 'Mute'}</Text>
              </View>

              <View style={styles.btnCol}>
                <TouchableOpacity
                  style={[styles.callBtn, { backgroundColor: colors.error }]}
                  onPress={handleHangUp}
                  activeOpacity={0.85}
                >
                  <SolarIcon name="Phone" variant="bold" size={30} color="#FFF" style={{ transform: [{ rotate: '135deg' }] }} />
                </TouchableOpacity>
                <Text style={styles.btnCaption}>End Call</Text>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.background, // Respects dark/light mode automatically
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: { width: '100%', alignItems: 'center', paddingHorizontal: 28 },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: c.accentSoft,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: c.accent,
    marginBottom: 32,
  },
  rolePillText: { color: c.accent, fontSize: 11, fontFamily: 'Poppins_800ExtraBold', letterSpacing: 0.8 },
  avatarRing: {
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: c.accentSoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 22,
    borderWidth: 1,
    borderColor: c.accent,
  },
  avatarCircle: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: c.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: { fontSize: 36, fontFamily: 'Poppins_800ExtraBold', color: '#FFFFFF' },
  nameText: { fontSize: 26, fontFamily: 'Poppins_700Bold', color: c.textPrimary, textAlign: 'center' },
  roleSubText: { fontSize: 13, fontFamily: 'Poppins_600SemiBold', color: c.accent, marginTop: 4, letterSpacing: 0.5 },
  statusText: {
    fontSize: 16,
    color: c.textSecondary,
    marginTop: 10,
    marginBottom: 64,
    fontFamily: 'Poppins_500Medium',
  },
  actionRow: { flexDirection: 'row', gap: 64, alignItems: 'center' },
  activeControlsRow: { flexDirection: 'row', gap: 48, alignItems: 'center' },
  btnCol: { alignItems: 'center', gap: 10 },
  callBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  controlButton: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlActive: { backgroundColor: c.accent },
  btnCaption: { color: c.textPrimary, fontSize: 12, fontFamily: 'Poppins_600SemiBold' },
});