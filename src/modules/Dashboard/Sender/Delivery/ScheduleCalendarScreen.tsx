import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSchedule } from './ScheduleContext';

const { width } = Dimensions.get('window');

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function ScheduleCalendarScreen({ navigation }: any) {
  const { state, dispatch } = useSchedule();
  const today = new Date();
  const insets = useSafeAreaInsets();
  
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed
  const [selectedDate, setSelectedDate] = useState<Date | null>(state.scheduledDate);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay();

  const calendarDays: (number | null)[] = [];
  for (let i = 0; i < firstDayOfWeek; i++) calendarDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(d);

  // Fill the end of the calendar with next month's days for visual completion if needed
  const totalCells = Math.ceil(calendarDays.length / 7) * 7;
  const trailingDays = totalCells - calendarDays.length;

  const isSelected = (day: number) =>
    selectedDate?.getDate() === day &&
    selectedDate?.getMonth() === month &&
    selectedDate?.getFullYear() === year;

  const isPastDay = (day: number) => {
    const date = new Date(year, month, day);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return date < todayStart;
  };

  const handleSelect = (day: number) => {
    setSelectedDate(new Date(year, month, day));
  };

  const goNext = () => {
    if (selectedDate) {
      dispatch({ type: 'SET_SCHEDULED_DATE', payload: selectedDate });
      navigation.navigate('PickupLocation', { type: 'pickup' });
    }
  };

  return (
    <View style={styles.container}>
      {/* Custom Orange Header matching other screens */}
      <View style={[styles.headerBackground, { paddingTop: insets.top + 10 }]}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={28} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Schedule Delivery</Text>
        </View>
        
        <Text style={styles.headerSubtitle}>
          Your trusted partner in fast, secure, and{'\n'}hassle-free delivery services.
        </Text>

        <Image 
          source={require('../../../../../assets/Car-Grey.png')} 
          style={styles.carImage} 
        />
      </View>

      {/* Main Content Area */}
      <View style={styles.contentContainer}>
        <View style={styles.card}>
          
          {/* Card Title */}
          <View style={styles.cardTitleRow}>
            {/* Using the package icon tinted orange as a placeholder */}
            <Image 
              source={require('../../../../../assets/package-sizes.png')} 
              style={[styles.titleIcon, { tintColor: '#F59E0B' }]} 
            />
            <Text style={styles.cardTitle}>Schedule Delivery</Text>
          </View>

          {/* Calendar Container */}
          <View style={styles.calendarContainer}>
            
            {/* Month/Year Selector */}
            <View style={styles.monthSelectorRow}>
              <TouchableOpacity onPress={() => setMonth(m => (m === 0 ? 11 : m - 1))}>
                <Ionicons name="chevron-back" size={20} color="#111827" />
              </TouchableOpacity>
              
              <View style={styles.dropdownsContainer}>
                <TouchableOpacity style={styles.dropdownBox}>
                  <Text style={styles.dropdownText}>{MONTHS[month]}</Text>
                  <Ionicons name="chevron-down" size={14} color="#111827" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.dropdownBox}>
                  <Text style={styles.dropdownText}>{year}</Text>
                  <Ionicons name="chevron-down" size={14} color="#111827" />
                </TouchableOpacity>
              </View>

              <TouchableOpacity onPress={() => setMonth(m => (m === 11 ? 0 : m + 1))}>
                <Ionicons name="chevron-forward" size={20} color="#111827" />
              </TouchableOpacity>
            </View>

            {/* Day labels */}
            <View style={styles.weekRow}>
              {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
                <Text key={d} style={styles.weekDay}>{d}</Text>
              ))}
            </View>

            {/* Calendar grid */}
            <View style={styles.calendarGrid}>
              {calendarDays.map((day, idx) => (
                <View key={`day-${idx}`} style={styles.dayCellContainer}>
                  {day != null ? (
                    <TouchableOpacity
                      style={[
                        styles.dayCell,
                        isSelected(day) && styles.selectedDay,
                      ]}
                      disabled={isPastDay(day)}
                      onPress={() => handleSelect(day)}
                      activeOpacity={0.7}
                    >
                      <Text style={[
                        styles.dayText,
                        isSelected(day) && styles.selectedDayText,
                        isPastDay(day) && styles.pastDayText,
                      ]}>
                        {day}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.dayCell} />
                  )}
                </View>
              ))}
              
              {/* Render trailing empty days to keep grid perfect */}
              {Array.from({ length: trailingDays }).map((_, idx) => (
                <View key={`trail-${idx}`} style={styles.dayCellContainer}>
                  <View style={styles.dayCell}>
                    <Text style={styles.trailingDayText}>{idx + 1}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>

          {/* Bottom Actions */}
          <View style={styles.actionLinksRow}>
            <TouchableOpacity>
              <Text style={styles.actionLinkText}>Change Date</Text>
            </TouchableOpacity>
            <TouchableOpacity>
              <Text style={styles.actionLinkText}>Change Time</Text>
            </TouchableOpacity>
          </View>

          {/* Next Button */}
          <TouchableOpacity
            style={[styles.nextBtn, !selectedDate && styles.disabledBtn]}
            disabled={!selectedDate}
            onPress={goNext}
            activeOpacity={0.8}
          >
            <Text style={styles.nextBtnText}>Next: Schedule</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#F8F9FA' 
  },
  headerBackground: {
    backgroundColor: '#FA7A25',
    paddingHorizontal: 15,
    paddingBottom: 80, 
    position: 'relative',
    overflow: 'visible',
    height: 240,
    zIndex: 1,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  backButton: {
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#FFFFFF',
    lineHeight: 18,
    maxWidth: '70%',
  },
  carImage: {
    position: 'absolute',
    right: -30,
    bottom: 10, 
    width: 240,
    height: 120,
    resizeMode: 'contain',
    zIndex: 2,
  },
  contentContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 30, 
    zIndex: 0,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4,
    flex: 1,
    marginBottom: 20,
  },
  cardTitleRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    marginBottom: 24 
  },
  titleIcon: {
    width: 32,
    height: 32,
    marginRight: 10,
    resizeMode: 'contain',
  },
  cardTitle: { 
    fontSize: 18, 
    fontWeight: 'bold', 
    color: '#000000' 
  },
  
  // Calendar Container
  calendarContainer: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  monthSelectorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingHorizontal: 10,
  },
  dropdownsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dropdownBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginHorizontal: 4,
  },
  dropdownText: {
    fontSize: 14,
    color: '#111827',
    marginRight: 6,
  },
  weekRow: { 
    flexDirection: 'row', 
    marginBottom: 12 
  },
  weekDay: { 
    flex: 1, 
    textAlign: 'center', 
    fontWeight: '500', 
    color: '#9CA3AF', 
    fontSize: 11 
  },
  calendarGrid: { 
    flexDirection: 'row', 
    flexWrap: 'wrap' 
  },
  dayCellContainer: {
    width: '14.28%',
    aspectRatio: 1, // Ensures perfect squares for the grid
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
  },
  dayCell: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  dayText: { 
    fontSize: 14, 
    color: '#111827',
    fontWeight: '500',
  },
  selectedDay: { 
    backgroundColor: '#111827', 
  },
  selectedDayText: { 
    color: '#FFFFFF' 
  },
  pastDayText: { 
    color: '#D1D5DB' 
  },
  trailingDayText: {
    color: '#D1D5DB',
    fontSize: 14,
  },

  // Action Links
  actionLinksRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    marginBottom: 'auto',
  },
  actionLinkText: {
    color: '#FA7A25', // Orange text
    fontSize: 13,
    fontWeight: '600',
  },

  // Next Button
  nextBtn: {
    backgroundColor: '#000000',
    borderRadius: 30,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  disabledBtn: { 
    backgroundColor: '#D1D5DB' 
  },
  nextBtnText: { 
    color: '#FFFFFF', 
    fontWeight: '600', 
    fontSize: 15 
  },
});