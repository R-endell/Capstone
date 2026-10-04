// src/modules/Dashboard/Sender/Delivery/ScheduleCalendarScreen.tsx
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Dimensions, Platform, Animated, Easing, StatusBar, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSchedule } from './ScheduleContext';
import DateTimePicker from '@react-native-community/datetimepicker';

const { width } = Dimensions.get('window');
const ORANGE = '#F27024';
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
      animate(cardAnim, 120),
      animate(gridAnim, 240),
      animate(buttonAnim, 360),
    ]).start();
  }, [headerAnim, cardAnim, gridAnim, buttonAnim]);

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
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" translucent />

      {/* Minimalist Top Header */}
      <Animated.View
        style={[styles.headerContainer, { paddingTop: insets.top + 10 }, fadeUp(headerAnim, -14)]}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backCircleBtn}
          activeOpacity={0.85}
        >
          <Ionicons name="arrow-back" size={20} color="#111827" />
        </TouchableOpacity>

        <View style={styles.headerTextContainer}>
          <View style={styles.stepBadge}>
            <Text style={styles.stepBadgeText}>STEP 3 OF 4</Text>
          </View>
          <Text style={styles.headerTitle}>Schedule Delivery</Text>
        </View>
      </Animated.View>

      {/* Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={[styles.card, fadeUp(cardAnim, 20)]}>
          {/* Card Header */}
          <View style={styles.cardTitleRow}>
            <View style={styles.cardIconBox}>
              <Ionicons name="calendar-outline" size={18} color={ORANGE} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Pick a Date & Time</Text>
              <Text style={styles.cardSubtitle}>Select when you'd like your package picked up</Text>
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
                <Text style={styles.timeLabel}>PICKUP TIME</Text>
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
              <Ionicons name="checkmark-circle" size={16} color="#059669" />
              <View style={{ flex: 1 }}>
                <Text style={styles.summaryLabel}>Selected schedule</Text>
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
  container: { flex: 1, backgroundColor: '#FFFFFF' },

  /* Minimalist Header */
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    backgroundColor: '#FFFFFF',
  },
  backCircleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
    marginRight: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  headerTextContainer: { flex: 1 },
  stepBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FFE4D2',
    marginBottom: 2,
  },
  stepBadgeText: {
    color: ORANGE,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.3,
  },

  /* Scroll */
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 16 },

  /* Card */
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  cardIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FFE4D2',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.3,
  },
  cardSubtitle: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
    marginTop: 2,
  },

  /* Calendar */
  calendarContainer: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
    backgroundColor: '#F9FAFB',
  },
  monthSelectorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  navBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  monthTitleBox: { alignItems: 'center' },
  monthTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#111827',
    letterSpacing: -0.2,
  },

  weekRow: { flexDirection: 'row', marginBottom: 8 },
  weekDay: {
    flex: 1,
    textAlign: 'center',
    fontWeight: '800',
    color: '#9CA3AF',
    fontSize: 10,
    letterSpacing: 0.5,
  },
  weekDayWeekend: { color: ORANGE },

  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCellContainer: {
    width: '14.28%',
    aspectRatio: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
  },
  dayCell: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
  },
  dayText: {
    fontSize: 12,
    color: '#111827',
    fontWeight: '700',
  },
  selectedDay: {
    backgroundColor: ORANGE,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
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
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  timeSectionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  timeIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#FFF7ED',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FFE4D2',
  },
  timeLabel: {
    fontSize: 8,
    color: '#6B7280',
    fontWeight: '800',
    letterSpacing: 0.8,
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
    paddingHorizontal: 12,
    paddingVertical: 7,
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
    gap: 10,
    backgroundColor: '#ECFDF5',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  summaryLabel: {
    fontSize: 9,
    color: '#059669',
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  summaryValue: {
    fontSize: 12,
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
    borderRadius: 16,
    paddingVertical: 16,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  disabledBtn: {
    backgroundColor: '#F3F4F6',
    shadowOpacity: 0,
    elevation: 0,
  },
  nextBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
    letterSpacing: 0.2,
  },
});