import React, { useState, useRef, useEffect } from 'react';
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

const ORANGE = '#FA7A25';

const SIZE_META = {
  Small: { color: '#3B82F6', bg: '#EFF6FF', icon: 'cube-outline' },
  Medium: { color: ORANGE, bg: '#FFF7ED', icon: 'cube' },
  Large: { color: '#8B5CF6', bg: '#F5F3FF', icon: 'file-tray-full-outline' },
} as const;

export default function AddItemScreen({ route, navigation }: any) {
  const { size } = route.params;
  const { dispatch } = useSchedule();
  const insets = useSafeAreaInsets();

  const [description, setDescription] = useState('');
  const [fragile, setFragile] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  // Animations
  const headerAnim = useRef(new Animated.Value(0)).current;
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
      animate(photoAnim, 120),
      animate(descAnim, 240),
      animate(fragileAnim, 360),
      animate(buttonAnim, 480),
    ]).start();
  }, [headerAnim, photoAnim, descAnim, fragileAnim, buttonAnim]);

  const fadeUp = (value: Animated.Value, distance = 20) => ({
    opacity: value,
    transform: [
      {
        translateY: value.interpolate({
          inputRange: [0, 1],
          outputRange: [distance, 0],
        }),
      },
    ],
  });

  const animatePressIn = () => {
    Animated.spring(buttonScale, { toValue: 0.97, useNativeDriver: true, speed: 30, bounciness: 4 }).start();
  };
  const animatePressOut = () => {
    Animated.spring(buttonScale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
  };

  const meta = SIZE_META[size as keyof typeof SIZE_META] || SIZE_META.Small;

  /* ------------------------------------------------------------------ */
  /* Image Picker                                                        */
  /* ------------------------------------------------------------------ */
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

  /* ------------------------------------------------------------------ */
  /* Add Item                                                            */
  /* ------------------------------------------------------------------ */
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

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={ORANGE} />

      {/* Header */}
      <Animated.View
        style={[styles.header, { paddingTop: insets.top + 14 }, fadeUp(headerAnim, -14)]}
      >
        <View style={styles.headerTopRow}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            activeOpacity={0.85}
          >
            <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerSub}>Add to shipment</Text>
            <Text style={styles.headerTitle}>New {size} Item</Text>
          </View>
          <View style={[styles.sizeBadge, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
            <Ionicons name={meta.icon as any} size={14} color="#FFFFFF" />
            <Text style={styles.sizeBadgeText}>{size}</Text>
          </View>
        </View>
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
                color={focused ? ORANGE : '#9CA3AF'}
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.input}
                placeholder="e.g., Glass flower vase"
                placeholderTextColor="#9CA3AF"
                value={description}
                onChangeText={setDescription}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                maxLength={100}
              />
            </View>
            <Text style={styles.helperText}>
              {description.length}/100 characters
            </Text>
          </Animated.View>

          {/* Fragile Toggle */}
          <Animated.View style={[styles.toggleCard, fadeUp(fragileAnim, 20)]}>
            <View style={[styles.toggleIconBox, fragile && styles.toggleIconBoxOn]}>
              <Ionicons
                name={fragile ? 'warning' : 'warning-outline'}
                size={20}
                color={fragile ? '#EF4444' : '#9CA3AF'}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Fragile / Handle with care</Text>
              <Text style={styles.toggleSub}>
                {fragile ? 'Providers will be notified' : 'Enable for delicate items'}
              </Text>
            </View>
            <Switch
              trackColor={{ false: '#E5E7EB', true: '#FECACA' }}
              thumbColor={fragile ? '#EF4444' : '#FFFFFF'}
              ios_backgroundColor="#E5E7EB"
              value={fragile}
              onValueChange={setFragile}
            />
          </Animated.View>

          {/* Summary chip */}
          <Animated.View style={[styles.summaryChip, fadeUp(fragileAnim, 20)]}>
            <Ionicons name="information-circle-outline" size={14} color="#3B82F6" />
            <Text style={styles.summaryChipText}>
              This item will be added as a <Text style={{ fontWeight: '800' }}>{size}</Text> package
              {fragile ? ' marked as fragile' : ''}.
            </Text>
          </Animated.View>

          {/* Add Button */}
          <Animated.View
            style={[
              fadeUp(buttonAnim, 20),
              { transform: [{ scale: buttonScale }] },
            ]}
          >
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },

  /* ------------------------------------------------------------------ */
  /* Header                                                              */
  /* ------------------------------------------------------------------ */
  header: {
    backgroundColor: ORANGE,
    paddingHorizontal: 20,
    paddingBottom: 20,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 6,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  headerSub: {
    fontSize: 11,
    color: '#FFE0C7',
    fontWeight: '600',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  sizeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  sizeBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },

  /* ------------------------------------------------------------------ */
  /* Content                                                             */
  /* ------------------------------------------------------------------ */
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 40,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#374151',
    letterSpacing: 0.3,
    marginBottom: 10,
    textTransform: 'uppercase',
  },

  /* Photo */
  photoBox: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#E5E7EB',
    borderRadius: 18,
    height: 160,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    backgroundColor: '#FFFFFF',
  },
  photoBoxFilled: {
    borderStyle: 'solid',
    borderColor: '#FFE4D2',
    backgroundColor: '#FFF7ED',
    padding: 0,
    overflow: 'hidden',
  },
  photoIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  photoPlaceholderTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
    marginTop: 4,
  },
  photoPlaceholderText: {
    color: '#9CA3AF',
    fontSize: 11,
    marginTop: 3,
    fontWeight: '500',
  },
  photoPreviewContainer: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  photoPreview: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  replaceBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(17,24,39,0.75)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  replaceBadgeText: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  /* Description */
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  inputWrapperFocused: {
    borderColor: ORANGE,
    shadowColor: ORANGE,
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 2,
  },
  inputIcon: {
    paddingLeft: 14,
    paddingRight: 4,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 10,
    fontSize: 14,
    color: '#111827',
    fontWeight: '600',
  },
  helperText: {
    fontSize: 10,
    color: '#9CA3AF',
    fontWeight: '500',
    marginTop: 6,
    marginLeft: 4,
    textAlign: 'right',
  },

  /* Fragile Toggle */
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    marginTop: 20,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  toggleIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  toggleIconBoxOn: {
    backgroundColor: '#FEF2F2',
  },
  toggleLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.2,
  },
  toggleSub: {
    fontSize: 11,
    color: '#9CA3AF',
    fontWeight: '500',
    marginTop: 2,
  },

  /* Summary */
  summaryChip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 22,
    borderWidth: 1,
    borderColor: '#DBEAFE',
  },
  summaryChipText: {
    flex: 1,
    fontSize: 11,
    color: '#1E40AF',
    fontWeight: '600',
    lineHeight: 16,
  },

  /* Add Button */
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111827',
    borderRadius: 16,
    paddingVertical: 16,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 5,
  },
  addBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.2,
  },
});