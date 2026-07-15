import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

interface Props {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  rightElement?: React.ReactNode;
  stepIndicator?: {
    current: number;
    total: number;
  };
}

export default function OrangeHeader({ title, subtitle, showBack = true, rightElement, stepIndicator }: Props) {
  const navigation = useNavigation();

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        {showBack && (
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color="#FFF" />
          </TouchableOpacity>
        )}
        <View style={styles.textBlock}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        
        {/* Step Indicator (optional) */}
        {stepIndicator && (
          <View style={styles.stepIndicator}>
            {[...Array(stepIndicator.total)].map((_, index) => (
              <React.Fragment key={index}>
                <View style={[
                  styles.stepDot,
                  index < stepIndicator.current && styles.stepDotActive,
                  index === stepIndicator.current - 1 && styles.stepDotCurrent
                ]} />
                {index < stepIndicator.total - 1 && (
                  <View style={[
                    styles.stepLine,
                    index < stepIndicator.current - 1 && styles.stepLineActive
                  ]} />
                )}
              </React.Fragment>
            ))}
          </View>
        )}
        
        {/* Right Element */}
        {rightElement && (
          <View style={styles.rightElement}>
            {rightElement}
          </View>
        )}
        
        {/* Decorative Icon */}
        {!rightElement && !stepIndicator && (
          <View style={styles.decorativeIcon}>
            <Ionicons name="cube-outline" size={28} color="rgba(255,255,255,0.3)" />
          </View>
        )}
      </View>
      
      {/* Optional bottom accent line */}
      <View style={styles.accentLine} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#F27024',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  textBlock: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  subtitle: {
    fontSize: 12,
    color: '#FFDDC2',
    marginTop: 2,
    fontWeight: '400',
  },
  
  // Step Indicator
  stepIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 12,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  stepDotActive: {
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  stepDotCurrent: {
    backgroundColor: '#FFFFFF',
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  stepLine: {
    width: 16,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginHorizontal: 4,
  },
  stepLineActive: {
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  
  // Right Element
  rightElement: {
    marginLeft: 12,
  },
  
  // Decorative Icon
  decorativeIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
  },
  
  // Accent Line
  accentLine: {
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginTop: 12,
    borderRadius: 1,
  },
});