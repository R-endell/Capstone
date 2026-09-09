import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PaymentMethod } from '../types/payment';
import { PAYMENT_METHOD_INFO } from '../utils/paymentHelpers';

interface Props {
  paymentMethod: PaymentMethod;
  onPress?: () => void;
  onDelete?: () => void;
  onSetDefault?: () => void;
  showActions?: boolean;
}

export default function PaymentMethodCard({
  paymentMethod,
  onPress,
  onDelete,
  onSetDefault,
  showActions = false,
}: Props) {
  const normalizedType =
    paymentMethod.payment_method_type === 'maya' ? 'paymaya' : paymentMethod.payment_method_type;
  const info = (PAYMENT_METHOD_INFO as any)[normalizedType];
  const isDefault = paymentMethod.is_default;
  const isActive = paymentMethod.status === 'active';

  return (
    <TouchableOpacity
      style={[styles.card, !isActive && styles.inactiveCard]}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={!isActive}
    >
      <View style={styles.cardContent}>
        <View style={styles.leftSection}>
          {/* ✅ Logo without circle background */}
          {info?.image ? (
            <Image source={info.image} style={styles.methodImage} />
          ) : (
            <Text style={styles.iconText}>{info?.icon || '💳'}</Text>
          )}

          <View style={styles.infoSection}>
            <Text style={styles.methodName}>{info?.label || paymentMethod.payment_method_type}</Text>
            <Text style={styles.methodDescription}>
              {paymentMethod.last_four_digits
                ? `•••• ${paymentMethod.last_four_digits}`
                : info?.description}
            </Text>
          </View>
        </View>

        <View style={styles.rightSection}>
          {isDefault && (
            <View style={styles.defaultBadge}>
              <Text style={styles.defaultBadgeText}>Default</Text>
            </View>
          )}
          {!isActive && (
            <View style={styles.inactiveBadge}>
              <Text style={styles.inactiveBadgeText}>Inactive</Text>
            </View>
          )}
          {showActions && (
            <TouchableOpacity onPress={onDelete} style={styles.deleteButton}>
              <Ionicons name="trash-outline" size={20} color="#EF4444" />
            </TouchableOpacity>
          )}
          <Ionicons name="chevron-forward" size={20} color="#D1D5DB" />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
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
  },
  inactiveCard: {
    opacity: 0.6,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 14,
  },
  methodImage: {
    width: 36,
    height: 36,
    resizeMode: 'contain',
  },
  iconText: {
    fontSize: 24,
  },
  infoSection: {
    flex: 1,
  },
  methodName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  methodDescription: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  defaultBadge: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  defaultBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#10B981',
  },
  inactiveBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  inactiveBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#D97706',
  },
  deleteButton: {
    padding: 4,
  },
});