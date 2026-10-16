// src/modules/Dashboard/Sender/Delivery/AddItemScreen.tsx
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Image,
  Switch,
  Alert,
  Animated,
  Easing,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useSchedule } from './ScheduleContext';
import { useTheme, ThemeColors } from '../../../../utils/themeContext';

const ORANGE = '#FA7A25';

const SIZE_META = {
  Small: {
    color: '#3B82F6',
    bg: '#EFF6FF',
    bgDark: '#0F2744',
    image: require('../../../../../assets/package-size.png'),
    headerImgSize: 100,
  },
  Medium: {
    color: ORANGE,
    bg: '#FFF7ED',
    bgDark: '#2A1A0E',
    image: require('../../../../../assets/package-size.png'),
    headerImgSize: 130,
  },
  Large: {
    color: '#8B5CF6',
    bg: '#F5F3FF',
    bgDark: '#231542',
    image: require('../../../../../assets/package-size.png'),
    headerImgSize: 160,
  },
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
  const boxAnim = useRef(new Animated.Value(0)).current;
  const photoAnim = useRef(new Animated.Value(0)).current;
  const descAnim = useRef(new Animated.Value(0)).current;
  const fragileAnim = useRef(new Animated.Value(0)).current;
  const buttonAnim = useRef(new Animated.Value(0)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(value, {
        toValue: 1,
        duration,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });

    Animated.parallel([
      animate(headerAnim, 0),
      animate(boxAnim, 120),
      animate(photoAnim, 200),
      animate(descAnim, 280),
      animate(fragileAnim, 360),
      animate(buttonAnim, 440),
    ]).start();
  }, [headerAnim, boxAnim, photoAnim, descAnim, fragileAnim, buttonAnim]);

  const fadeUp = (value: Animated.Value, distance = 20) => ({
    opacity: value,
    transform: [{
      translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }),
    }],
  });

  const boxSlide = {
    opacity: boxAnim,
    transform: [{
      translateX: boxAnim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }),
    }],
  };

  const animatePressIn = () => {
    Animated.spring(buttonScale, { toValue: 0.97, useNativeDriver: true, speed: 30, bounciness: 4 }).start();
  };
  const animatePressOut = () => {
    Animated.spring(buttonScale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
  };

  const meta = SIZE_META[size as keyof typeof SIZE_META] || SIZE_META.Small;
  const sizeBg = isDark ? meta.bgDark : meta.bg;

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
      <StatusBar barStyle="light-content" backgroundColor={ORANGE} />

      <Animated.View style={[styles.headerBackground, { paddingTop: insets.top + 12 }, fadeUp(headerAnim, -14)]}>
        <View style={styles.headerInnerContent}>
          <View style={styles.stepRow}>
            <View style={styles.stepPill}>
              <Text style={styles.stepText}>ADD ITEM</Text>
            </View>
          </View>

          <View style={styles.headerTopRow}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} activeOpacity={0.85}>
              <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
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

        <Animated.Image
          source={meta.image}
          style={[
            styles.headerGraphicImage,
            { width: meta.headerImgSize, height: meta.headerImgSize },
            boxSlide,
          ]}
          resizeMode="contain"
        />
      </Animated.View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
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
                    <Ionicons name="camera-reverse-outline" size={12} color="#FFFFFF" />
                    <Text style={styles.replaceBadgeText}>Replace</Text>
                  </View>
                </View>
              ) : (
                <>
                  <View style={styles.photoIconCircle}>
                    <Ionicons name="camera-outline" size={26} color={ORANGE} />
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
              <Ionicons
                name="create-outline"
                size={18}
                color={focused ? ORANGE : colors.textMuted}
                style={styles.inputIcon}
              />
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
              <Ionicons
                name={fragile ? 'warning' : 'warning-outline'}
                size={20}
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
            <Ionicons name="information-circle-outline" size={14} color={isDark ? '#93C5FD' : '#3B82F6'} />
            <Text style={styles.summaryChipText}>
              This item will be added as a <Text style={{ fontWeight: '800' }}>{size}</Text> package
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
              <Ionicons name="add-circle" size={18} color="#FFFFFF" />
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
    backgroundColor: ORANGE,
    position: 'relative',
    overflow: 'hidden',
    paddingBottom: 22,
    zIndex: 1,
  },
  headerInnerContent: { paddingHorizontal: 24 },
  stepRow: { flexDirection: 'row', marginBottom: 10 },
  stepPill: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  stepText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 12 },
  backButton: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  headerSub: { fontSize: 11, color: '#FFE0C7', fontWeight: '600', letterSpacing: 0.3, marginBottom: 2 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.3 },
  headerSubtitle: {
    fontSize: 13, color: '#FFE0C7', lineHeight: 18, maxWidth: '52%', fontWeight: '500',
  },
  headerGraphicImage: { position: 'absolute', right: -35, bottom: -15, zIndex: 2 },

  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 40,
    backgroundColor: c.background,
  },
  sectionLabel: {
    fontSize: 12, fontWeight: '800', color: c.textPrimary,
    letterSpacing: 0.3, marginBottom: 10, textTransform: 'uppercase',
  },

  photoBox: {
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: c.border,
    borderRadius: 16, height: 160,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 24, backgroundColor: c.card,
  },
  photoBoxFilled: {
    borderStyle: 'solid', borderColor: ORANGE, backgroundColor: c.accentSoft,
    padding: 0, overflow: 'hidden',
  },
  photoIconCircle: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: c.accentSoft,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 10, borderWidth: 1, borderColor: ORANGE,
  },
  photoPlaceholderTitle: {
    fontSize: 14, fontWeight: '800', color: c.textPrimary, marginTop: 4,
  },
  photoPlaceholderText: {
    color: c.textMuted, fontSize: 11, marginTop: 3, fontWeight: '500',
  },
  photoPreviewContainer: { width: '100%', height: '100%', position: 'relative' },
  photoPreview: { width: '100%', height: '100%', resizeMode: 'cover' },
  replaceBadge: {
    position: 'absolute', top: 10, right: 10,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(17,24,39,0.75)',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
  },
  replaceBadgeText: { fontSize: 11, color: '#FFFFFF', fontWeight: '700', letterSpacing: 0.2 },

  inputWrapper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 14,
  },
  inputWrapperFocused: {
    borderColor: ORANGE, backgroundColor: c.accentSoft,
  },
  inputIcon: { paddingLeft: 14, paddingRight: 4 },
  input: {
    flex: 1, paddingVertical: 14, paddingHorizontal: 10,
    fontSize: 15, color: c.textPrimary, fontWeight: '600',
  },
  helperText: {
    fontSize: 10, color: c.textMuted, fontWeight: '500',
    marginTop: 6, marginLeft: 4, textAlign: 'right',
  },

  toggleCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: c.card, borderRadius: 16, padding: 14,
    marginTop: 10, marginBottom: 14,
    borderWidth: 1, borderColor: c.border,
  },
  toggleIconBox: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: c.background,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: c.divider,
  },
  toggleIconBoxOn: { backgroundColor: c.errorBg, borderColor: c.error },
  toggleLabel: {
    fontSize: 13, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.2,
  },
  toggleSub: {
    fontSize: 11, color: c.textMuted, fontWeight: '500', marginTop: 2,
  },

  summaryChip: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: isDark ? '#0F2744' : '#F0FDF4',
    borderRadius: 12, padding: 12, marginBottom: 22,
    borderWidth: 1, borderColor: isDark ? '#1E3A5F' : '#DCFCE7',
  },
  summaryChipText: {
    flex: 1, fontSize: 11,
    color: isDark ? '#93C5FD' : '#166534',
    fontWeight: '600', lineHeight: 16,
  },

  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.textPrimary, borderRadius: 16, paddingVertical: 18, gap: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: isDark ? 0.4 : 0.2, shadowRadius: 12, elevation: 5,
  },
  addBtnText: {
    color: c.card, fontWeight: '800', fontSize: 15, letterSpacing: 0.2,
  },
});