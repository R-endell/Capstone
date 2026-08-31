import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  StatusBar,
  Modal,
  TouchableWithoutFeedback,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { PaymentMethod } from '../../../types/payment';
import { paymentService } from '../../../services/paymentService';
import PaymentMethodCard from '../../../components/PaymentMethodCard';

export default function PaymentMethodsScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);

  const loadPaymentMethods = async () => {
    try {
      setLoading(true);
      const methods = await paymentService.getPaymentMethods();
      setPaymentMethods(methods);
    } catch (error) {
      console.error('Error loading payment methods:', error);
      Alert.alert('Error', 'Failed to load payment methods');
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadPaymentMethods();
    }, [])
  );

  const handleAddPaymentMethod = () => {
    navigation.navigate('AddPaymentMethod');
  };

  const handleDeletePaymentMethod = async (paymentMethod: PaymentMethod) => {
    Alert.alert(
      'Remove Payment Method',
      `Are you sure you want to remove this payment method?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              setProcessing(true);
              await paymentService.deletePaymentMethod(paymentMethod.id);
              await loadPaymentMethods();
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to remove payment method');
            } finally {
              setProcessing(false);
            }
          },
        },
      ]
    );
  };

  const handleSetDefault = async (paymentMethod: PaymentMethod) => {
    try {
      setProcessing(true);
      await paymentService.setDefaultPaymentMethod(paymentMethod.id);
      await loadPaymentMethods();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to set default payment method');
    } finally {
      setProcessing(false);
    }
  };

  const openActionSheet = (paymentMethod: PaymentMethod) => {
    setSelectedMethod(paymentMethod);
    setModalVisible(true);
  };

  const handleAction = (action: 'setDefault' | 'remove') => {
    if (!selectedMethod) return;
    setModalVisible(false);
    if (action === 'setDefault') {
      handleSetDefault(selectedMethod);
    } else {
      handleDeletePaymentMethod(selectedMethod);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#FA7A25" />

      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Payment Methods</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity
          style={styles.addButton}
          onPress={handleAddPaymentMethod}
          disabled={processing}
        >
          <Ionicons name="add-circle-outline" size={24} color="#F27024" />
          <Text style={styles.addButtonText}>Add Payment Method</Text>
        </TouchableOpacity>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#F27024" />
          </View>
        ) : paymentMethods.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="card-outline" size={64} color="#D1D5DB" />
            <Text style={styles.emptyTitle}>No Payment Methods</Text>
            <Text style={styles.emptySubtext}>
              Add a payment method to start booking deliveries.
            </Text>
          </View>
        ) : (
          paymentMethods.map((method) => (
            <PaymentMethodCard
              key={method.id}
              paymentMethod={method}
              onPress={() => openActionSheet(method)}
              onDelete={() => handleDeletePaymentMethod(method)}
              onSetDefault={() => handleSetDefault(method)}
              showActions={true}
            />
          ))
        )}
      </ScrollView>

      {/* Custom Action Sheet Modal */}
      <Modal
        transparent={true}
        visible={modalVisible}
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>
                    {selectedMethod?.payment_method_type?.toUpperCase() || 'Payment Method'}
                  </Text>
                  <TouchableOpacity onPress={() => setModalVisible(false)}>
                    <Ionicons name="close" size={24} color="#111827" />
                  </TouchableOpacity>
                </View>
                <View style={styles.modalDivider} />
                <TouchableOpacity
                  style={styles.modalOption}
                  onPress={() => handleAction('setDefault')}
                >
                  <Ionicons
                    name={selectedMethod?.is_default ? 'checkmark-circle' : 'radio-button-off-outline'}
                    size={22}
                    color={selectedMethod?.is_default ? '#10B981' : '#6B7280'}
                  />
                  <Text style={[styles.modalOptionText, selectedMethod?.is_default && styles.modalOptionTextActive]}>
                    {selectedMethod?.is_default ? 'Remove as Default' : 'Set as Default'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalOption, styles.modalOptionDanger]}
                  onPress={() => handleAction('remove')}
                >
                  <Ionicons name="trash-outline" size={22} color="#EF4444" />
                  <Text style={styles.modalOptionTextDanger}>Remove</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
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
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F27024',
    borderStyle: 'dashed',
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F27024',
    marginLeft: 8,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 8,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 24,
    width: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 5,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  modalDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginBottom: 16,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  modalOptionDanger: {
    borderBottomWidth: 0,
  },
  modalOptionText: {
    fontSize: 16,
    marginLeft: 12,
    color: '#374151',
  },
  modalOptionTextActive: {
    color: '#10B981',
  },
  modalOptionTextDanger: {
    fontSize: 16,
    marginLeft: 12,
    color: '#EF4444',
  },
});