// src/modules/Authentication/IdentityVerificationScreen.tsx
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons, Feather } from '@expo/vector-icons';

export default function IdentityVerificationScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FA7A25" />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 20 }]}>
        <TouchableOpacity 
          onPress={() => navigation.goBack()} 
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Identity Verification</Text>
      </View>

      <ScrollView 
        showsVerticalScrollIndicator={false} 
        contentContainerStyle={styles.scrollContent}
      >
        {/* Progress Stepper */}
        <View style={styles.stepperContainer}>
          {/* Step 1 */}
          <View style={styles.stepWrapper}>
            <View style={[styles.stepCircle, styles.stepActive]}>
              <Text style={styles.stepTextActive}>1</Text>
            </View>
            <Text style={styles.stepLabel}>1. Personal Info</Text>
          </View>

          <View style={styles.stepLine} />

          {/* Step 2 */}
          <View style={styles.stepWrapper}>
            <View style={[styles.stepCircle, styles.stepActive]}>
              <Feather name="chevron-right" size={16} color="#FFFFFF" />
            </View>
            <Text style={styles.stepLabel}>2. ID Document</Text>
          </View>

          <View style={styles.stepLine} />

          {/* Step 3 */}
          <View style={styles.stepWrapper}>
            <View style={[styles.stepCircle, styles.stepInactive]}>
              <Feather name="chevron-right" size={16} color="#FFFFFF" />
            </View>
            <Text style={styles.stepLabel}>3. Selfie</Text>
          </View>
        </View>

        {/* Driver's License Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Driver's License / Government ID</Text>
          <View style={styles.cardContent}>
            <View style={styles.idPlaceholder}>
              <Ionicons name="card-outline" size={32} color="#9CA3AF" />
            </View>
            <TouchableOpacity style={styles.actionButton} activeOpacity={0.8}>
              <Text style={styles.actionButtonText}>Upload Photo</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Live Selfie Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Live Selfie</Text>
          <View style={styles.cardContent}>
            <View style={styles.iconPlaceholder}>
              <Ionicons name="camera-outline" size={32} color="#374151" />
            </View>
            <TouchableOpacity style={styles.actionButton} activeOpacity={0.8}>
              <Text style={styles.actionButtonText}>Take Selfie</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Checklist */}
        <View style={styles.checklistContainer}>
          <View style={styles.checklistItem}>
            <Ionicons name="checkmark-circle" size={22} color="#FA7A25" />
            <Text style={styles.checklistText}>Clear Photo</Text>
          </View>
          <View style={styles.checklistItem}>
            <Ionicons name="checkmark-circle" size={22} color="#FA7A25" />
            <Text style={styles.checklistText}>Face clearly visible in selfie</Text>
          </View>
          <View style={styles.checklistItem}>
            <Ionicons name="checkmark-circle" size={22} color="#FA7A25" />
            <Text style={styles.checklistText}>No edits or filters</Text>
          </View>
        </View>

        {/* Submit Button */}
        <TouchableOpacity style={styles.submitButton} activeOpacity={0.8}>
          <Text style={styles.submitButtonText}>Submit for Review</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    backgroundColor: '#FA7A25',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 100,
  },
  backButton: {
    marginRight: 12,
    bottom: -40,
    zIndex: 10, 
  },
  headerTitle: {
    fontSize: 23,
    fontWeight: '800',
    color: '#000',
    bottom: -40,
    zIndex: 10, 
  },
  scrollContent: {
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 40,
  },
  stepWrapper: {
    alignItems: 'center',
    width: 80,
  },
  stepCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    zIndex: 2,
  },
  stepActive: {
    backgroundColor: '#FA7A25',
  },
  stepInactive: {
    backgroundColor: '#D1D5DB',
  },
  stepTextActive: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
  stepLabel: {
    fontSize: 11,
    color: '#6B7280',
    textAlign: 'center',
  },
  stepLine: {
    flex: 1,
    height: 2,
    backgroundColor: '#6B7280',
    marginTop: 20,
    marginHorizontal: -15,
    zIndex: 1,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingVertical: 20,
    paddingHorizontal: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 16,
  },
  cardContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  idPlaceholder: {
    width: 100,
    height: 60,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  iconPlaceholder: {
    width: 60,
    height: 60,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  actionButton: {
    backgroundColor: '#FA7A25',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 6,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  checklistContainer: {
    marginTop: 10,
    marginBottom: 32,
    paddingHorizontal: 10,
  },
  checklistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  checklistText: {
    fontSize: 14,
    color: '#374151',
    marginLeft: 12,
    fontWeight: '500',
  },
  submitButton: {
    backgroundColor: '#FA7A25',
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
});