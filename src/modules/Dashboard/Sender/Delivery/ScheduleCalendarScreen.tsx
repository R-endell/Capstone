// src/modules/Dashboard/Sender/Delivery/ScheduleCalendarScreen.tsx
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image,
  Dimensions, Platform, Animated, Easing, StatusBar, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSchedule } from './ScheduleContext';
import DateTimePicker from '@react-native-community/datetimepicker';

const { width } = Dimensions.get('window');
const ORANGE = '#FA7A25';
const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEK_DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];

export default function ScheduleCalendarScreen({ navigation }: any) {
  const { state, dispatch } = useSchedule();
  const today = new Date();
  const insets = useSafeAreaInsets();

  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date | null>(state.scheduledDate || today);
  const [selectedTime, setSelectedTime] = useState<Date>(state.scheduledDate || new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);

  // Animations
  const headerAnim = useRef(new Animated.Value(0)).current;
  const carAnim = useRef(new Animated.Value(0)).current;
  const cardAnim = useRef(new Animated.Value(0)).current;
  const gridAnim = useRef(new Animated.Value(0)).current;
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
      animate(carAnim, 120),
      animate(cardAnim, 200),
      animate(gridAnim, 320),
      animate(buttonAnim, 440),
    ]).start();
  }, [headerAnim, carAnim, cardAnim, gridAnim, buttonAnim]);

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

  const carSlide = {
    opacity: carAnim,
    transform: [
      {
        translateX: carAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [40, 0],
        }),
      },
    ],
  };

  const animatePressIn = () => {
    Animated.spring(buttonScale, { toValue: 0.97, useNativeDriver: true, speed: 30, bounciness: 4 }).start();
  };
  const animatePressOut = () => {
    Animated.spring(buttonScale, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
  };

  /* ------------------------------------------------------------------ */
  /* Calendar math                                                       */
  /* ------------------------------------------------------------------ */
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();

  const calendarDays: (number | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) calendarDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(d);

  const totalCells = Math.ceil(calendarDays.length / 7) * 7;
  const trailingDays = totalCells - calendarDays.length;

  const isSelected = (day: number) =>
    selectedDate?.getDate() === day &&
    selectedDate?.getMonth() === month &&
    selectedDate?.getFullYear() === year;

  const isToday = (day: number) =>
    today.getDate() === day &&
    today.getMonth() === month &&
    today.getFullYear() === year;

  const isPastDay = (day: number) => {
    const date = new Date(year, month, day);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return date < todayStart;
  };

  const handleSelect = (day: number) => {
    const newDate = new Date(year, month, day, 0, 0, 0, 0);
    setSelectedDate(newDate);
  };

  const goPrevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };

  const goNextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  const goNext = () => {
    if (!selectedDate) return;
    const finalDateTime = new Date(
      selectedDate.getFullYear(),
      selectedDate.getMonth(),
      selectedDate.getDate(),
      selectedTime.getHours(),
      selectedTime.getMinutes(),
      0,
      0
    );
    dispatch({ type: 'SET_SCHEDULED_DATE', payload: finalDateTime });
    navigation.navigate('PickupLocation', { type: 'pickup' });
  };

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={ORANGE} />

      {/* Header */}
      <Animated.View
        style={[styles.headerBackground, { paddingTop: insets.top + 10 }, fadeUp(headerAnim, -14)]}
      >
        <View style={styles.stepRow}>
          <View style={styles.stepPill}>
            <Text style={styles.stepText}>STEP 3 OF 4</Text>
          </View>
        </View>

        <View style={styles.headerTopRow}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
            activeOpacity={0.85}
          >
            <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerSub}>Schedule Delivery</Text>
            <Text style={styles.headerTitle}>Pick a Date & Time</Text>
          </View>
        </View>

        <Text style={styles.headerSubtitle}>
          Choose when you'd like us to pick up your package.
        </Text>

        <Animated.Image
          source={require('../../../../../assets/Car-Grey.png')}
          style={[styles.carImage, carSlide]}
        />
      </Animated.View>

      {/* Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={[styles.card, fadeUp(cardAnim, 20)]}>
          {/* Card Header */}
          <View style={styles.cardTitleRow}>
            <View style={styles.cardIconBox}>
              <Ionicons name="calendar-outline" size={18} color={ORANGE} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Select a Date</Text>
              <Text style={styles.cardSubtitle}>Then choose your pickup time</Text>
            </View>
          </View>

          {/* Calendar */}
          <Animated.View style={[styles.calendarContainer, fadeUp(gridAnim, 20)]}>
            {/* Month Navigation */}
            <View style={styles.monthSelectorRow}>
              <TouchableOpacity
                onPress={goPrevMonth}
                style={styles.navBtn}
                activeOpacity={0.7}
              >
                <Ionicons name="chevron-back" size={16} color="#111827" />
              </TouchableOpacity>

              <View style={styles.monthTitleBox}>
                <Text style={styles.monthTitle}>{MONTHS_FULL[month]} {year}</Text>
              </View>

              <TouchableOpacity
                onPress={goNextMonth}
                style={styles.navBtn}
                activeOpacity={0.7}
              >
                <Ionicons name="chevron-forward" size={16} color="#111827" />
              </TouchableOpacity>
            </View>

            {/* Week header */}
            <View style={styles.weekRow}>
              {WEEK_DAYS.map((d, i) => (
                <Text
                  key={d}
                  style={[styles.weekDay, (i === 0 || i === 6) && styles.weekDayWeekend]}
                >
                  {d}
                </Text>
              ))}
            </View>

            {/* Grid */}
            <View style={styles.calendarGrid}>
              {calendarDays.map((day, idx) => (
                <View key={`day-${idx}`} style={styles.dayCellContainer}>
                  {day != null ? (
                    <TouchableOpacity
                      style={[
                        styles.dayCell,
                        isToday(day) && !isSelected(day) && styles.todayCell,
                        isSelected(day) && styles.selectedDay,
                      ]}
                      disabled={isPastDay(day)}
                      onPress={() => handleSelect(day)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.dayText,
                          isSelected(day) && styles.selectedDayText,
                          isToday(day) && !isSelected(day) && styles.todayDayText,
                          isPastDay(day) && styles.pastDayText,
                        ]}
                      >
                        {day}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.dayCell} />
                  )}
                </View>
              ))}
              {Array.from({ length: trailingDays }).map((_, idx) => (
                <View key={`trail-${idx}`} style={styles.dayCellContainer}>
                  <View style={styles.dayCell}>
                    <Text style={styles.trailingDayText}>{idx + 1}</Text>
                  </View>
                </View>
              ))}
            </View>
          </Animated.View>

          {/* Time Section */}
          <View style={styles.timeSection}>
            <View style={styles.timeSectionLeft}>
              <View style={styles.timeIconBox}>
                <Ionicons name="time-outline" size={18} color={ORANGE} />
              </View>
              <View>
                <Text style={styles.timeLabel}>Pickup Time</Text>
                <Text style={styles.timeValue}>
                  {selectedTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.changeTimeBtn}
              onPress={() => !showTimePicker && setShowTimePicker(true)}
              activeOpacity={0.85}
            >
              <Ionicons name="create-outline" size={13} color={ORANGE} />
              <Text style={styles.changeTimeText}>Change</Text>
            </TouchableOpacity>
          </View>

          {showTimePicker && (
            <DateTimePicker
              value={selectedTime}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(event, time) => {
                if (Platform.OS === 'android') setShowTimePicker(false);
                if (event.type === 'set' && time) {
                  setSelectedTime(new Date(1970, 0, 1, time.getHours(), time.getMinutes(), 0, 0));
                }
              }}
            />
          )}

          {/* Summary */}
          {selectedDate && (
            <View style={styles.summaryCard}>
              <Ionicons name="checkmark-circle" size={16} color="#10B981" />
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryLabel}>Selected date</Text>
                <Text style={styles.summaryValue} numberOfLines={1}>
                  {selectedDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  {' · '}
                  {selectedTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            </View>
          )}

          {/* Next Button */}
          <Animated.View style={[fadeUp(buttonAnim, 20), { transform: [{ scale: buttonScale }] }]}>
            <TouchableOpacity
              style={[styles.nextBtn, !selectedDate && styles.disabledBtn]}
              disabled={!selectedDate}
              onPress={goNext}
              onPressIn={animatePressIn}
              onPressOut={animatePressOut}
              activeOpacity={0.9}
            >
              <Text style={styles.nextBtnText}>Continue to Location</Text>
              <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },

  /* Header */
  headerBackground: {
    backgroundColor: ORANGE,
    paddingHorizontal: 20,
    paddingBottom: 60,
    position: 'relative',
    overflow: 'visible',
    height: 220,
    zIndex: 1,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  stepRow: { flexDirection: 'row', marginBottom: 12 },
  stepPill: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  stepText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 12,
  },
  backButton: {
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
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#FFE0C7',
    lineHeight: 17,
    maxWidth: '65%',
    fontWeight: '500',
  },
  carImage: {
    position: 'absolute',
    right: -30,
    bottom: 5,
    width: 210,
    height: 105,
    resizeMode: 'contain',
    zIndex: 2,
    opacity: 0.85,
  },

  /* Scroll */
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 30 },

  /* Card */
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  cardIconBox: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.2,
  },
  cardSubtitle: {
    fontSize: 10,
    color: '#6B7280',
    fontWeight: '500',
    marginTop: 2,
  },

  /* Calendar */
  calendarContainer: {
    borderWidth: 1,
    borderColor: '#F3F4F6',
    borderRadius: 16,
    padding: 10,
    marginBottom: 14,
    backgroundColor: '#FAFAFA',
  },
  monthSelectorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  navBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  monthTitleBox: { alignItems: 'center' },
  monthTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.2,
  },

  weekRow: { flexDirection: 'row', marginBottom: 6 },
  weekDay: {
    flex: 1,
    textAlign: 'center',
    fontWeight: '700',
    color: '#9CA3AF',
    fontSize: 10,
    letterSpacing: 0.3,
  },
  weekDayWeekend: { color: ORANGE },

  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCellContainer: {
    width: '14.28%',
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 1,
  },
  dayCell: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  dayText: {
    fontSize: 12,
    color: '#111827',
    fontWeight: '600',
  },
  selectedDay: {
    backgroundColor: ORANGE,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 2,
  },
  selectedDayText: { color: '#FFFFFF', fontWeight: '800' },
  todayCell: {
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: ORANGE,
  },
  todayDayText: { color: ORANGE, fontWeight: '800' },
  pastDayText: { color: '#D1D5DB' },
  trailingDayText: { color: '#E5E7EB', fontSize: 12, fontWeight: '500' },

  /* Time Section */
  timeSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FAFAFA',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  timeSectionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  timeIconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
  },
  timeLabel: {
    fontSize: 10,
    color: '#6B7280',
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  timeValue: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '800',
    marginTop: 1,
    letterSpacing: -0.2,
  },
  changeTimeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FFE4D2',
  },
  changeTimeText: {
    color: ORANGE,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.2,
  },

  /* Summary */
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ECFDF5',
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  summaryLabel: {
    fontSize: 9,
    color: '#059669',
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  summaryValue: {
    fontSize: 11,
    color: '#065F46',
    fontWeight: '700',
    marginTop: 1,
  },

  /* Next Button */
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111827',
    borderRadius: 14,
    paddingVertical: 14,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
  },
  disabledBtn: {
    backgroundColor: '#D1D5DB',
    shadowOpacity: 0,
    elevation: 0,
  },
  nextBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 0.2,
  },
});