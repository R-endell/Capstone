// src/modules/Authentication/TwoFactorAuthScreen.tsx
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  StatusBar,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

export default function TwoFactorAuthScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  
  // Using an array to represent the 6 digits (pre-filled here to match the image design)
  const [code, setCode] = useState(['4', '3', '1', '1', '0', '1']);

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
        <Text style={styles.headerTitle}>Two-Factor Authentication</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          
          {/* Shield Icon */}
          <View style={styles.iconContainer}>
            <Ionicons name="shield-checkmark" size={56} color="#10B981" />
          </View>

          {/* Instructions */}
          <Text style={styles.instructionText}>
            A 6-digit verification code{'\n'}has been sent to your{'\n'}registered phone number
          </Text>
          <Text style={styles.phoneNumber}>+63 9*********</Text>

          {/* Code Inputs */}
          <View style={styles.codeContainer}>
            {code.map((digit, index) => (
              <TextInput
                key={index}
                style={styles.codeInput}
                value={digit}
                keyboardType="numeric"
                maxLength={1}
                editable={false} // Disabled for visual representation matching the image
              />
            ))}
          </View>

          {/* Timer */}
          <Text style={styles.timerText}>Code Expires in 4:32</Text>

          {/* Buttons */}
          <TouchableOpacity style={styles.resendButton} activeOpacity={0.8}>
            <Text style={styles.resendButtonText}>Resend Code</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.verifyButton} activeOpacity={0.8}>
            <Text style={styles.verifyButtonText}>Verify Code</Text>
          </TouchableOpacity>

          {/* Footer Note */}
          <Text style={styles.footerText}>
            This extra layer of security helps protect your{'\n'}account and deliveries
          </Text>

        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB', 
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
    paddingHorizontal: 20,
    paddingTop: 100,
    paddingBottom: 40,
    marginTop: -40, // Pulls the card slightly up into the orange header area
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingVertical: 32,
    paddingHorizontal: 20,
    alignItems: 'center',
    // Shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  iconContainer: {
    marginBottom: 20,
  },
  instructionText: {
    fontSize: 16,
    color: '#374151',
    textAlign: 'center',
    fontWeight: '500',
    marginBottom: 10,
    lineHeight: 22,
  },
  phoneNumber: {
    fontSize: 16,
    color: '#111827',
    fontWeight: '700',
    marginBottom: 24,
  },
  codeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 10,
    marginBottom: 16,
  },
  codeInput: {
    width: 40,
    height: 50,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 6,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '600',
    color: '#000',
    backgroundColor: '#FFFFFF',
  },
  timerText: {
    fontSize: 13,
    color: '#4B5563',
    marginBottom: 24,
  },
  resendButton: {
    width: '100%',
    backgroundColor: '#D1D5DB', // Light gray
    paddingVertical: 14,
    borderRadius: 6,
    alignItems: 'center',
    marginBottom: 12,
  },
  resendButtonText: {
    color: '#374151',
    fontWeight: '600',
    fontSize: 14,
  },
  verifyButton: {
    width: '100%',
    backgroundColor: '#FA7A25', // Orange
    paddingVertical: 14,
    borderRadius: 6,
    alignItems: 'center',
    marginBottom: 24,
  },
  verifyButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  footerText: {
    fontSize: 11,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 16,
  },
});