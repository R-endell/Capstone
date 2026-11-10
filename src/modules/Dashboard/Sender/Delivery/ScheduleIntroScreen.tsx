// src/modules/Dashboard/Sender/Delivery/ScheduleIntroScreen.tsx
import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { useTheme, ThemeColors } from '../../../../utils/themeContext';
import { useSchedule } from './ScheduleContext';
import { SolarIcon } from '../../../../components/ui/SolarIcon';

const { width } = Dimensions.get('window');

export default function ScheduleIntroScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const styles = makeStyles(colors, isDark, insets);
  const { dispatch: scheduleDispatch } = useSchedule();

  const handleContinue = () => {
    scheduleDispatch({ type: 'RESET' });
    navigation.navigate('DropoffType', { mode: 'schedule' });
  };

  return (
    <View style={styles.container}>
      <View style={styles.gradientContainer} pointerEvents="none">
        <Svg height="100%" width="100%">
          <Defs>
            <LinearGradient id="topGrad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.accent} stopOpacity="0.5" />
              <Stop offset="0.5" stopColor={colors.background} stopOpacity="0.3" />
              <Stop offset="1" stopColor={colors.background} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#topGrad)" />
        </Svg>
      </View>

      <TouchableOpacity 
        style={[styles.backBtn, { top: insets.top + 10 }]} 
        onPress={() => navigation.goBack()} 
        activeOpacity={0.8}
      >
        <SolarIcon name="ArrowLeft" variant="linear" size={22} color={colors.textPrimary} />
      </TouchableOpacity>

      <View style={styles.contentContainer}>
        <View style={styles.heroContainer}>
          <Image
            source={require('../../../../../assets/schedule-banner-transparent.png')}
            style={styles.heroImage}
            resizeMode="contain"
          />
        </View>

        <View style={styles.textContentWrap}>
          <Text style={styles.title}>Ship on your schedule</Text>

          <View style={styles.featureList}>
            <FeatureItem 
              icon="Lightning" 
              title="Never miss a moment" 
              desc="Lock in your delivery now and ensure your package arrives exactly when you need it." 
            />
            <FeatureItem 
              icon="Clock" 
              title="Book fast, ship later" 
              desc="Schedule deliveries days ahead of time. Change or cancel anytime." 
            />
            <FeatureItem 
              icon="ShieldCheck" 
              title="Skip the last-minute rush" 
              desc="Why hunt for a driver last-minute? Secure your slot early and save time." 
            />
            <FeatureItem 
              icon="Package" 
              title="All deliveries, one tap away" 
              desc="Upcoming trips or past deliveries, track everything in seconds." 
            />
          </View>
        </View>
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity style={styles.primaryBtn} onPress={handleContinue} activeOpacity={0.9}>
          <Text style={styles.primaryBtnText}>Schedule a delivery now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const FeatureItem = ({ icon, title, desc }: { icon: any, title: string, desc: string }) => {
  const { colors, isDark } = useTheme();
  return (
    <View style={featureStyles.container}>
      <View style={[featureStyles.iconWrap, { backgroundColor: colors.accentSoft }]}>
        <SolarIcon 
          name={icon} 
          variant="bold" 
          size={22} 
          color={isDark ? '#FFFFFF' : colors.accent} // ✅ Uniform Color
        />
      </View>
      <View style={featureStyles.textWrap}>
        <Text style={[featureStyles.title, { color: colors.textPrimary }]}>{title}</Text>
        <Text style={[featureStyles.desc, { color: colors.textSecondary }]}>{desc}</Text>
      </View>
    </View>
  );
};

const featureStyles = StyleSheet.create({
  container: { flexDirection: 'row', gap: 16, marginBottom: 20 },
  iconWrap: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  textWrap: { flex: 1, justifyContent: 'center' },
  title: { fontSize: 16, fontFamily: 'Poppins_600SemiBold', marginBottom: 4 },
  desc: { fontSize: 13, fontFamily: 'Poppins_400Regular', lineHeight: 18 },
});

const makeStyles = (c: ThemeColors, isDark: boolean, insets: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  
  gradientContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: insets.top + 100,
    zIndex: 1,
  },

  backBtn: {
    position: 'absolute',
    left: 20,
    zIndex: 10,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: c.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, 
    borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 2 }, 
    shadowOpacity: 0.02, 
    shadowRadius: 1, 
    elevation: 0,
  },
  
  contentContainer: {
    flex: 1,
    paddingTop: insets.top > 0 ? insets.top * 0.5 : 20,
  },

  heroContainer: {
    width: '100%', 
    aspectRatio: 1.5, 
    alignItems: 'center', 
    justifyContent: 'center',
    marginBottom: 10,
  },
  heroImage: { width: '100%', height: '100%' },
  
  textContentWrap: {
    paddingHorizontal: 24,
    flex: 1,
  },
  
  title: {
    fontSize: 28, 
    fontFamily: 'Poppins_700Bold', 
    color: c.textPrimary,
    letterSpacing: -0.3, 
    marginBottom: 24,
  },
  
  featureList: { flex: 1 },
  
  bottomBar: {
    paddingHorizontal: 24, paddingTop: 16,
    backgroundColor: c.background,
    borderTopWidth: 1, 
    borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
  
  primaryBtn: {
    backgroundColor: c.accent, 
    height: 56, 
    borderRadius: 12,
    alignItems: 'center', 
    justifyContent: 'center',
    shadowColor: c.accent, 
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, 
    shadowRadius: 4, 
    elevation: 1,
  },
  primaryBtnText: { 
    color: '#FFFFFF', 
    fontSize: 16, 
    fontFamily: 'Poppins_700Bold' 
  },
});