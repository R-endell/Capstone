import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  StatusBar,
  Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { paymentService } from '../../../services/paymentService';
import { PaymentMethodType } from '../../../types/payment';
import { PAYMENT_METHOD_INFO } from '../../../utils/paymentHelpers';

// ✅ Supabase Edge Function base URL
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1`;

// ✅ Payment methods available
const PAYMENT_METHODS = [
  {
    type: 'gcash' as PaymentMethodType,
    ...PAYMENT_METHOD_INFO.gcash,
  },
  {
    type: 'paymaya' as PaymentMethodType,
    ...PAYMENT_METHOD_INFO.paymaya,
  },
];

export default function AddPaymentMethodScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethodType | null>(null);
  const [activeMethods, setActiveMethods] = useState<string[]>([]);
  const [fetchingMethods, setFetchingMethods] = useState(true);

  useEffect(() => {
    loadExistingMethods();
  }, []);

  const loadExistingMethods = async () => {
    try {
      const methods = await paymentService.getPaymentMethods();
      const allTypes = methods.map((m) => m.payment_method_type);
      setActiveMethods(allTypes);
    } catch (error) {
      console.error('Failed to fetch existing methods', error);
    } finally {
      setFetchingMethods(false);
    }
  };

  const handleSelectMethod = async (type: PaymentMethodType) => {
    if (activeMethods.includes(type)) {
      Alert.alert('Already Added', `You already have a ${type.toUpperCase()} payment method.`);
      return;
    }

    setSelectedMethod(type);
    setLoading(true);

    try {
      // ✅ IMPORTANT: Use the public edge function that performs a 302 redirect.
      // This function MUST be deployed as PUBLIC (no auth) in Supabase.
      const redirectTo = `${EDGE_FUNCTION_URL}/paymongo-return`;

      const result = await paymentService.createPaymentMethod(type, redirectTo);

      if (result.redirect_url) {
        const browserResult = await WebBrowser.openAuthSessionAsync(
          result.redirect_url,
          redirectTo
        );

        if (browserResult.type === 'success') {
          await paymentService.verifyPaymentMethod(result.paymongo_payment_method_id);
          Alert.alert(
            'Success',
            'Payment method added successfully!',
            [{ text: 'OK', onPress: () => navigation.goBack() }]
          );
        } else if (browserResult.type === 'cancel') {
          Alert.alert('Cancelled', 'You cancelled the payment method setup.');
          navigation.goBack();
        }
      } else {
        Alert.alert('Error', 'Unable to process payment method. Please try again.');
      }
    } catch (error: any) {
      console.error('Error adding payment method:', error);
      Alert.alert('Error', error.message || 'Failed to add payment method');
    } finally {
      setLoading(false);
      setSelectedMethod(null);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#FA7A25" />

      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add Payment Method</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <Text style={styles.description}>Choose a payment method to add to your account.</Text>

        {fetchingMethods ? (
          <ActivityIndicator size="large" color="#FA7A25" style={{ marginTop: 20 }} />
        ) : (
          PAYMENT_METHODS.map((method) => {
            const isAlreadyLinked = activeMethods.includes(method.type);

            return (
              <TouchableOpacity
                key={method.type}
                style={[
                  styles.methodCard,
                  selectedMethod === method.type && styles.methodCardSelected,
                  (loading || isAlreadyLinked) && styles.methodCardDisabled,
                ]}
                onPress={() => handleSelectMethod(method.type)}
                disabled={loading || isAlreadyLinked}
                activeOpacity={0.7}
              >
                <View style={styles.methodCardContent}>
                  <Image source={method.image} style={styles.methodImage} />

                  <View style={styles.methodInfo}>
                    <Text style={styles.methodLabel}>{method.label}</Text>
                    <Text style={styles.methodDescription}>
                      {isAlreadyLinked ? 'Already connected' : method.description}
                    </Text>
                  </View>

                  {isAlreadyLinked ? (
                    <Ionicons name="checkmark-circle" size={24} color="#10B981" />
                  ) : (
                    <Ionicons name="chevron-forward" size={20} color="#D1D5DB" />
                  )}
                </View>
                {loading && selectedMethod === method.type && (
                  <View style={styles.loadingOverlay}>
                    <ActivityIndicator size="small" color="#FFFFFF" />
                    <Text style={styles.loadingText}>Connecting...</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: '#FA7A25',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  headerRight: {
    width: 40,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  description: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 20,
    lineHeight: 20,
  },
  methodCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    position: 'relative',
    overflow: 'hidden',
  },
  methodCardSelected: {
    borderColor: '#F27024',
  },
  methodCardDisabled: {
    opacity: 0.6,
  },
  methodCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  methodImage: {
    width: 36,
    height: 36,
    resizeMode: 'contain',
  },
  methodInfo: {
    flex: 1,
  },
  methodLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  methodDescription: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(247, 112, 36, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  loadingText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 10,
  },
});