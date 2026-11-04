// src/modules/Dashboard/Sender/Delivery/ScheduleCalendarScreen.tsx
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Dimensions, Platform, Animated, Easing, StatusBar, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSchedule } from './ScheduleContext';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme, ThemeColors } from '../../../../utils/themeContext';
import { PhIcon } from '../../../../components/ui/PhIcon';

const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEK_DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];

export default function ScheduleCalendarScreen({ navigation }: any) {
  const { state, dispatch } = useSchedule();
  const today = new Date();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState<Date | null>(state.scheduledDate || today);
  const [selectedTime, setSelectedTime] = useState<Date>(state.scheduledDate || new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);

  const headerAnim = useRef(new Animated.Value(0)).current;
  const cardAnim = useRef(new Animated.Value(0)).current;
  const gridAnim = useRef(new Animated.Value(0)).current;
  const buttonAnim = useRef(new Animated.Value(0)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animate = (value: Animated.Value, delay: number, duration = 600) =>
      Animated.timing(value, {
        toValue: 1, duration, delay,
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
      0, 0
    );
    dispatch({ type: 'SET_SCHEDULED_DATE', payload: finalDateTime });
    navigation.navigate('PickupLocation', { type: 'pickup' });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.accent} />

      {/* Premium Header */}
      <Animated.View style={[styles.headerBackground, { paddingTop: insets.top + 12 }, fadeUp(headerAnim, -14)]}>
        <View style={styles.headerInnerContent}>
          <View style={styles.stepRow}>
            <View style={styles.stepPill}>
              <Text style={styles.stepText}>STEP 3 OF 4</Text>
            </View>
          </View>

          <View style={styles.headerTopRow}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} activeOpacity={0.85}>
              <PhIcon name="ArrowLeft" size={22} color="#FFFFFF" />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerSub}>Send Package Now</Text>
              <Text style={styles.headerTitle}>Schedule Delivery</Text>
            </View>
          </View>

          <Text style={styles.headerSubtitle}>
            Choose the exact date and time you want your package picked up.
          </Text>
        </View>
      </Animated.View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={[styles.card, fadeUp(cardAnim, 20)]}>
          <View style={styles.cardTitleRow}>
            <View style={styles.cardIconBox}>
              <PhIcon name="Calendar" size={20} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Pick a Date & Time</Text>
              <Text style={styles.cardSubtitle}>Select when you'd like your package picked up</Text>
            </View>
          </View>

          <Animated.View style={[styles.calendarContainer, fadeUp(gridAnim, 20)]}>
            <View style={styles.monthSelectorRow}>
              <TouchableOpacity onPress={goPrevMonth} style={styles.navBtn} activeOpacity={0.7}>
                <PhIcon name="CaretLeft" size={18} color={colors.textPrimary} />
              </TouchableOpacity>

              <View style={styles.monthTitleBox}>
                <Text style={styles.monthTitle}>{MONTHS_FULL[month]} {year}</Text>
              </View>

              <TouchableOpacity onPress={goNextMonth} style={styles.navBtn} activeOpacity={0.7}>
                <PhIcon name="CaretRight" size={18} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

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
                <PhIcon name="Clock" size={20} color={colors.accent} />
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
              <PhIcon name="PencilSimple" size={14} color={colors.accent} />
              <Text style={styles.changeTimeText}>Change</Text>
            </TouchableOpacity>
          </View>

          {showTimePicker && (
            <DateTimePicker
              value={selectedTime}
              mode="time"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              themeVariant={isDark ? 'dark' : 'light'}
              onChange={(event, time) => {
                if (Platform.OS === 'android') setShowTimePicker(false);
                if (event.type === 'set' && time) {
                  setSelectedTime(new Date(1970, 0, 1, time.getHours(), time.getMinutes(), 0, 0));
                }
              }}
            />
          )}

          {/* Summary Card */}
          {selectedDate && (
            <View style={styles.summaryCard}>
              <PhIcon name="CheckCircle" weight="fill" size={20} color={colors.success} />
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

          {/* Continue Button */}
          <Animated.View style={[fadeUp(buttonAnim, 20), { transform: [{ scale: buttonScale }] }]}>
            <TouchableOpacity
              style={[styles.nextBtn, !selectedDate && styles.disabledBtn]}
              disabled={!selectedDate}
              onPress={goNext}
              onPressIn={animatePressIn}
              onPressOut={animatePressOut}
              activeOpacity={0.9}
            >
              <Text style={[styles.nextBtnText, !selectedDate && styles.disabledBtnText]}>
                Continue to Location
              </Text>
              <PhIcon name="ArrowRight" size={18} color={selectedDate ? '#FFFFFF' : colors.textMuted} />
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </ScrollView>
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
  stepText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 16 },
  backButton: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.8)', fontWeight: '600', letterSpacing: 0.3, marginBottom: 2 },
  headerTitle: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.3 },
  headerSubtitle: {
    fontSize: 14, color: 'rgba(255,255,255,0.85)', lineHeight: 20, maxWidth: '90%', fontWeight: '500', marginTop: 4,
  },

  scrollView: { flex: 1, backgroundColor: c.background, zIndex: 3, elevation: 3 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 24 },

  card: {
    backgroundColor: c.background,
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  cardIconBox: {
    width: 44, height: 44, borderRadius: 14, backgroundColor: c.accentSoft,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: c.accent,
  },
  cardTitle: { fontSize: 18, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.3 },
  cardSubtitle: { fontSize: 13, color: c.textSecondary, fontWeight: '500', marginTop: 2 },

  calendarContainer: {
    borderWidth: 1, borderColor: c.border, borderRadius: 20, padding: 16,
    marginBottom: 16, backgroundColor: c.card,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.2 : 0.03, shadowRadius: 8, elevation: 2,
  },
  monthSelectorRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16,
  },
  navBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: c.background,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: c.border,
  },
  monthTitleBox: { alignItems: 'center' },
  monthTitle: { fontSize: 15, fontWeight: '800', color: c.textPrimary, letterSpacing: -0.2 },

  weekRow: { flexDirection: 'row', marginBottom: 12 },
  weekDay: {
    flex: 1, textAlign: 'center', fontWeight: '800', color: c.textMuted,
    fontSize: 11, letterSpacing: 0.5,
  },
  weekDayWeekend: { color: c.accent },

  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCellContainer: {
    width: '14.28%', aspectRatio: 1,
    justifyContent: 'center', alignItems: 'center', padding: 2,
  },
  dayCell: {
    width: '100%', height: '100%',
    justifyContent: 'center', alignItems: 'center', borderRadius: 12,
  },
  dayText: { fontSize: 14, color: c.textPrimary, fontWeight: '600' },
  
  selectedDay: {
    backgroundColor: c.accent,
    shadowColor: c.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 6, elevation: 4,
  },
  selectedDayText: { color: '#FFFFFF', fontWeight: '800' },
  
  todayCell: {
    backgroundColor: c.accentSoft,
    borderWidth: 1.5, borderColor: c.accent,
  },
  todayDayText: { color: c.accent, fontWeight: '800' },
  
  pastDayText: { color: c.textMuted, opacity: 0.4 },
  trailingDayText: { color: c.textMuted, fontSize: 14, fontWeight: '500', opacity: 0.3 },

  timeSection: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: c.card, borderRadius: 20, padding: 16, marginBottom: 16,
    borderWidth: 1, borderColor: c.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: isDark ? 0.2 : 0.03, shadowRadius: 8, elevation: 2,
  },
  timeSectionLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  timeIconBox: {
    width: 44, height: 44, borderRadius: 14, backgroundColor: c.accentSoft,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: c.accent,
  },
  timeLabel: { fontSize: 10, color: c.textMuted, fontWeight: '800', letterSpacing: 0.8 },
  timeValue: { fontSize: 16, color: c.textPrimary, fontWeight: '800', marginTop: 2, letterSpacing: -0.2 },
  
  changeTimeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12,
    backgroundColor: c.accentSoft,
    borderWidth: 1, borderColor: c.accent,
  },
  changeTimeText: { color: c.accent, fontSize: 12, fontWeight: '800', letterSpacing: 0.2 },

  summaryCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: c.successBg, borderRadius: 16, padding: 14, marginBottom: 20,
    borderWidth: 1, borderColor: c.success,
  },
  summaryLabel: {
    fontSize: 10, color: c.success, fontWeight: '800',
    letterSpacing: 0.8, textTransform: 'uppercase',
  },
  summaryValue: { fontSize: 14, color: c.success, fontWeight: '700', marginTop: 2 },

  nextBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.accent, borderRadius: 16, paddingVertical: 18, gap: 8,
    shadowColor: c.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  disabledBtn: {
    backgroundColor: c.divider, shadowOpacity: 0, elevation: 0,
    borderWidth: 1, borderColor: c.border,
  },
  nextBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 16, letterSpacing: 0.2 },
  disabledBtnText: { color: c.textMuted },
});