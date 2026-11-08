// src/modules/Dashboard/Sender/Delivery/AddItemScreen.tsx
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Image,
  Switch, Alert, Animated, Easing, StatusBar, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { useSchedule } from './ScheduleContext';
import { useTheme, ThemeColors } from '../../../../utils/themeContext';
import { SolarIcon } from '../../../../components/ui/SolarIcon';

const ORANGE = '#F27024';

const SIZE_META = {
  Small: { color: '#3B82F6', bg: '#EFF6FF', bgDark: '#0F2744' },
  Medium: { color: ORANGE, bg: '#FFF7ED', bgDark: '#2A1A0E' },
  Large: { color: '#8B5CF6', bg: '#F5F3FF', bgDark: '#231542' },
} as const;

export default function AddItemScreen({ route, navigation }: any) {
  const { size } = route.params;
  const { dispatch } = useSchedule();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [description, setDescription] = useState('');
  const [fragile, setFragile] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  const headerAnim = useRef(new Animated.Value(0)).current;
  const photoAnim = useRef(new Animated.Value(0)).current;
  const descAnim = useRef(new Animated.Value(0)).current;
  const fragileAnim = useRef(new Animated.Value(0)).current;
  const buttonAnim = useRef(new Animated.Value(0)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(value, {
        toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      });

    Animated.parallel([
      animate(headerAnim, 0),
      animate(photoAnim, 200),
      animate(descAnim, 280),
      animate(fragileAnim, 360),
      animate(buttonAnim, 440),
    ]).start();
  }, [headerAnim, photoAnim, descAnim, fragileAnim, buttonAnim]);

  const fadeUp = (value: Animated.Value, distance = 20) => ({
    opacity: value,
    transform: [{
      translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }),
    }],
  });

  const animatePressIn = () => {
    Animated.spring(buttonScale, { toValue: 0.97, useNativeDriver: true, speed: 30, bounciness: 4 }).start();
  };
  const animatePressOut = () => {
    Animated.spring(buttonScale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Allow access to photos to add a package picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.7,
    });
    if (!result.canceled) setPhotoUri(result.assets[0].uri);
  };

  const addItem = () => {
    if (!description.trim()) {
      Alert.alert('Missing', 'Please enter a description.');
      return;
    }
    dispatch({
      type: 'ADD_ITEM',
      payload: {
        id: Date.now().toString(),
        size,
        description: description.trim(),
        photoUri,
        fragile,
      },
    });
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.accent} />

      {/* Clean Premium Header */}
      <Animated.View style={[styles.headerBackground, { paddingTop: insets.top + 12 }, fadeUp(headerAnim, -14)]}>
        <View style={styles.headerInnerContent}>
          <View style={styles.stepRow}>
            <View style={styles.stepPill}>
              <Text style={styles.stepText}>ADD ITEM</Text>
            </View>
          </View>

          <View style={styles.headerTopRow}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} activeOpacity={0.85}>
              <SolarIcon name="ArrowLeft" variant="linear" size={22} color="#FFFFFF" />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerSub}>Add to shipment</Text>
              <Text style={styles.headerTitle}>New {size} Item</Text>
            </View>
          </View>

          <Text style={styles.headerSubtitle}>
            Provide details so providers can handle your package safely.
          </Text>
        </View>
      </Animated.View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Photo */}
          <Animated.View style={fadeUp(photoAnim, 20)}>
            <Text style={styles.sectionLabel}>Package Photo</Text>
            <TouchableOpacity
              style={[styles.photoBox, photoUri && styles.photoBoxFilled]}
              onPress={pickImage}
              activeOpacity={0.85}
            >
              {photoUri ? (
                <View style={styles.photoPreviewContainer}>
                  <Image source={{ uri: photoUri }} style={styles.photoPreview} />
                  <View style={styles.replaceBadge}>
                    <SolarIcon name="Camera" variant="linear" size={12} color="#FFFFFF" />
                    <Text style={styles.replaceBadgeText}>Replace</Text>
                  </View>
                </View>
              ) : (
                <>
                  <View style={styles.photoIconCircle}>
                    <SolarIcon name="Camera" variant="duotone" size={28} color={colors.accent} />
                  </View>
                  <Text style={styles.photoPlaceholderTitle}>Add package photo</Text>
                  <Text style={styles.photoPlaceholderText}>Helps providers handle with care</Text>
                </>
              )}
            </TouchableOpacity>
          </Animated.View>

          {/* Description */}
          <Animated.View style={fadeUp(descAnim, 20)}>
            <Text style={styles.sectionLabel}>Description</Text>
            <View style={[styles.inputWrapper, focused && styles.inputWrapperFocused]}>
              {/* ✅ FIX 1: Wrapped in View to apply padding properly */}
              <View style={styles.inputIcon}>
                <SolarIcon
                  name="Pen"
                  variant="linear"
                  size={18}
                  color={focused ? colors.accent : colors.textMuted}
                />
              </View>
              <TextInput
                style={styles.input}
                placeholder="e.g., Glass flower vase"
                placeholderTextColor={colors.textMuted}
                value={description}
                onChangeText={setDescription}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                maxLength={100}
              />
            </View>
            <Text style={styles.helperText}>{description.length}/100 characters</Text>
          </Animated.View>

          {/* Fragile Toggle */}
          <Animated.View style={[styles.toggleCard, fadeUp(fragileAnim, 20)]}>
            <View style={[styles.toggleIconBox, fragile && styles.toggleIconBoxOn]}>
              <SolarIcon
                name="Warning"
                variant={fragile ? "bold" : "duotone"}
                size={22}
                color={fragile ? colors.error : colors.textMuted}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Fragile / Handle with care</Text>
              <Text style={styles.toggleSub}>
                {fragile ? 'Providers will be notified' : 'Enable for delicate items'}
              </Text>
            </View>
            <Switch
              trackColor={{ false: colors.border, true: isDark ? '#5A1F1F' : '#FECACA' }}
              thumbColor={fragile ? colors.error : '#FFFFFF'}
              ios_backgroundColor={colors.border}
              value={fragile}
              onValueChange={setFragile}
            />
          </Animated.View>

          {/* Summary chip */}
          <Animated.View style={[styles.summaryChip, fadeUp(fragileAnim, 20)]}>
            <SolarIcon name="Info" variant="duotone" size={16} color={colors.accent} />
            <Text style={styles.summaryChipText}>
              This item will be added as a <Text style={{ fontFamily: 'Poppins_700Bold' }}>{size}</Text> package
              {fragile ? ' marked as fragile' : ''}.
            </Text>
          </Animated.View>

          {/* Add Button */}
          <Animated.View style={[fadeUp(buttonAnim, 20), { transform: [{ scale: buttonScale }] }]}>
            <TouchableOpacity
              style={styles.addBtn}
              onPress={addItem}
              onPressIn={animatePressIn}
              onPressOut={animatePressOut}
              activeOpacity={0.9}
            >
              {/* ✅ FIX 2: Changed variant to linear so it shows up white on orange */}
              <SolarIcon name="AddCircle" variant="linear" size={20} color="#FFFFFF" />
              <Text style={styles.addBtnText}>Add Item to Shipment</Text>
            </TouchableOpacity>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (c: ThemeColors, isDark: boolean) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },

  headerBackground: {
    backgroundColor: c.accent,
    position: 'relative',
    overflow: 'hidden',
    paddingBottom: 24,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    zIndex: 1,
  },
  headerInnerContent: { paddingHorizontal: 24 },
  stepRow: { flexDirection: 'row', marginBottom: 12 },
  stepPill: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  
  stepText: { color: '#FFFFFF', fontSize: 10, fontFamily: 'Poppins_800ExtraBold', letterSpacing: 0.8 },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 16 },
  backButton: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.8)', fontFamily: 'Poppins_600SemiBold', letterSpacing: 0.3, marginBottom: 2 },
  headerTitle: { fontSize: 24, fontFamily: 'Poppins_700Bold', color: '#FFFFFF', letterSpacing: -0.3 },
  headerSubtitle: {
    fontSize: 14, color: 'rgba(255,255,255,0.85)', lineHeight: 20, maxWidth: '90%', fontFamily: 'Poppins_400Regular', marginTop: 4,
  },

  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 40,
    backgroundColor: c.background,
  },
  
  sectionLabel: {
    fontSize: 12, fontFamily: 'Poppins_700Bold', color: c.textPrimary,
    letterSpacing: 0.5, marginBottom: 12, textTransform: 'uppercase',
  },

  photoBox: {
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)',
    borderRadius: 12, height: 180,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 28, backgroundColor: c.card,
  },
  photoBoxFilled: {
    borderStyle: 'solid', borderColor: c.accent, backgroundColor: c.accentSoft,
    padding: 0, overflow: 'hidden',
  },
  photoIconCircle: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: c.accentSoft,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 12, borderWidth: 1, borderColor: c.accent,
  },
  photoPlaceholderTitle: {
    fontSize: 15, fontFamily: 'Poppins_700Bold', color: c.textPrimary, marginTop: 4,
  },
  photoPlaceholderText: {
    color: c.textSecondary, fontSize: 12, fontFamily: 'Poppins_400Regular', marginTop: 4,
  },
  photoPreviewContainer: { width: '100%', height: '100%', position: 'relative' },
  photoPreview: { width: '100%', height: '100%', resizeMode: 'cover' },
  replaceBadge: {
    position: 'absolute', top: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(17,24,39,0.75)',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14,
  },
  replaceBadgeText: { fontSize: 12, color: '#FFFFFF', fontFamily: 'Poppins_600SemiBold', letterSpacing: 0.2 },

  inputWrapper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.card, borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', borderRadius: 12,
  },
  inputWrapperFocused: {
    borderColor: c.accent, backgroundColor: c.accentSoft,
  },
  inputIcon: { paddingLeft: 16, paddingRight: 8 }, // This now applies to the View wrapper
  input: {
    flex: 1, paddingVertical: 16, paddingHorizontal: 8,
    fontSize: 16, color: c.textPrimary, fontFamily: 'Poppins_500Medium',
  },
  helperText: {
    fontSize: 11, color: c.textMuted, fontFamily: 'Poppins_400Regular',
    marginTop: 8, marginLeft: 4, textAlign: 'right',
  },

  toggleCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: c.card, borderRadius: 12, padding: 16,
    marginTop: 12, marginBottom: 16,
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  toggleIconBox: {
    width: 48, height: 48, borderRadius: 12,
    backgroundColor: c.background,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  toggleIconBoxOn: { backgroundColor: c.errorBg, borderColor: c.error },
  toggleLabel: {
    fontSize: 15, fontFamily: 'Poppins_700Bold', color: c.textPrimary, letterSpacing: -0.2,
  },
  toggleSub: {
    fontSize: 12, color: c.textSecondary, fontFamily: 'Poppins_400Regular', marginTop: 3,
  },

  summaryChip: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: c.accentSoft,
    borderRadius: 12, padding: 14, marginBottom: 24,
    borderWidth: 1, borderColor: c.accent,
  },
  summaryChipText: {
    flex: 1, fontSize: 13, color: c.textPrimary,
    fontFamily: 'Poppins_400Regular', lineHeight: 18,
  },

  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.accent, borderRadius: 12, paddingVertical: 18, gap: 10,
    shadowColor: c.accent, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 4, elevation: 1,
  },
  addBtnText: {
    color: '#FFFFFF', fontFamily: 'Poppins_700Bold', fontSize: 16, letterSpacing: 0.2,
  },
});