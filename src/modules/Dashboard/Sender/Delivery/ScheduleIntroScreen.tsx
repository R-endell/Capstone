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
import { PhIcon } from '../../../../components/ui/PhIcon';

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
      {/* 
        👇 MANUAL GRADIENT TWEAKING HERE 👇
        Adjust the 'height' in styles.gradientContainer to make it taller/shorter.
        Adjust the 'stopOpacity' in the Stop tags to make it more/less visible.
      */}
      <View style={styles.gradientContainer} pointerEvents="none">
        <Svg height="100%" width="100%">
          <Defs>
            <LinearGradient id="topGrad" x1="0" y1="0" x2="0" y2="1">
              {/* Color at the very top (matches background) */}
              <Stop offset="0" stopColor={colors.accent} stopOpacity="0.5" />
              {/* Color in the middle of the gradient */}
              <Stop offset="0.5" stopColor={colors.background} stopOpacity="0.3" />
              {/* Fades to transparent */}
              <Stop offset="1" stopColor={colors.background} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#topGrad)" />
        </Svg>
      </View>

      {/* Floating Back Button */}
      <TouchableOpacity 
        style={[styles.backBtn, { top: insets.top + 10 }]} 
        onPress={() => navigation.goBack()} 
        activeOpacity={0.8}
      >
        <PhIcon name="ArrowLeft" size={22} color={colors.textPrimary} />
      </TouchableOpacity>

      {/* Main Content */}
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
              colors={colors} 
            />
            <FeatureItem 
              icon="Clock" 
              title="Book fast, ship later" 
              desc="Schedule deliveries days ahead of time. Change or cancel anytime." 
              colors={colors} 
            />
            <FeatureItem 
              icon="ShieldCheck" 
              title="Skip the last-minute rush" 
              desc="Why hunt for a driver last-minute? Secure your slot early and save time." 
              colors={colors} 
            />
            <FeatureItem 
              icon="Package" 
              title="All deliveries, one tap away" 
              desc="Upcoming trips or past deliveries, track everything in seconds." 
              colors={colors} 
            />
          </View>
        </View>
      </View>

      {/* Sticky Bottom CTA */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity style={styles.primaryBtn} onPress={handleContinue} activeOpacity={0.9}>
          <Text style={styles.primaryBtnText}>Schedule a delivery now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const FeatureItem = ({ icon, title, desc, colors }: { icon: any, title: string, desc: string, colors: ThemeColors }) => (
  <View style={featureStyles.container}>
    <View style={[featureStyles.iconWrap, { backgroundColor: colors.accentSoft }]}>
      <PhIcon name={icon} size={22} color={colors.accent} />
    </View>
    <View style={featureStyles.textWrap}>
      <Text style={[featureStyles.title, { color: colors.textPrimary }]}>{title}</Text>
      <Text style={[featureStyles.desc, { color: colors.textSecondary }]}>{desc}</Text>
    </View>
  </View>
);

const featureStyles = StyleSheet.create({
  container: { flexDirection: 'row', gap: 16, marginBottom: 20 },
  iconWrap: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  textWrap: { flex: 1, justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  desc: { fontSize: 13, lineHeight: 18 },
});

const makeStyles = (c: ThemeColors, isDark: boolean, insets: any) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background },
  
  /* 
    👇 GRADIENT TWEAKING 👇 
    Increase or decrease 'height' to control how far down the gradient reaches.
  */
  gradientContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: insets.top + 100, // Change 100 to make the gradient taller/shorter
    zIndex: 1,
  },

  backBtn: {
    position: 'absolute',
    left: 20,
    zIndex: 10,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: c.card, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: c.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 6, elevation: 3,
  },
  
  contentContainer: {
    flex: 1,
    paddingTop: insets.top > 0 ? insets.top * 0.5 : 20, // Adjusts image position relative to status bar
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
    flex: 1, // Ensures the text takes up remaining space without pushing the bottom bar down
  },
  
  title: {
    fontSize: 28, fontWeight: '800', color: c.textPrimary,
    letterSpacing: -0.5, marginBottom: 24,
  },
  featureList: { flex: 1 },
  
  bottomBar: {
    paddingHorizontal: 24, paddingTop: 16,
    backgroundColor: c.background,
    borderTopWidth: 1, borderTopColor: c.divider,
  },
  primaryBtn: {
    backgroundColor: c.accent, height: 56, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: c.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});