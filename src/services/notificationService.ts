// src/services/notificationService.ts
import { Linking, Platform } from 'react-native';
import { supabase } from '../utils/supabase';

/**
 * Open the device's SMS app to send the OTP to the receiver's phone number.
 */
export const sendDeliveryOTP = async (
  phoneNumber: string,
  otp: string,
  deliveryId: number,
  receiverName?: string
): Promise<boolean> => {
  try {
    const message = `Hi ${receiverName || 'there'}! Your package #${deliveryId} is on the way. Share this OTP with the provider upon delivery: ${otp}. Valid for 24 hours.`;

    const url = Platform.select({
      ios: `sms:${phoneNumber}&body=${encodeURIComponent(message)}`,
      android: `sms:${phoneNumber}?body=${encodeURIComponent(message)}`,
    });

    if (url) {
      await Linking.openURL(url);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Failed to open SMS app for OTP:', error);
    return false;
  }
};

/**
 * Verify OTP for delivery confirmation
 */
export const verifyDeliveryOTP = async (
  deliveryId: number,
  otp: string
): Promise<{ success: boolean; message: string }> => {
  try {
    const { data: confirmation, error } = await supabase
      .from('delivery_confirmations')
      .select('*')
      .eq('delivery_id', deliveryId)
      .single();

    if (error || !confirmation) {
      return { success: false, message: 'Confirmation record not found.' };
    }

    if (new Date() > new Date(confirmation.otp_expires_at)) {
      return { success: false, message: 'OTP has expired.' };
    }

    if (confirmation.otp_verified) {
      return { success: false, message: 'Already verified.' };
    }

    if (confirmation.attempts >= 5) {
      return { success: false, message: 'Too many attempts.' };
    }

    if (String(confirmation.system_otp) !== String(otp).trim()) {
      await supabase
        .from('delivery_confirmations')
        .update({ attempts: confirmation.attempts + 1 })
        .eq('confirmation_id', confirmation.confirmation_id);

      return {
        success: false,
        message: `Invalid OTP. ${4 - confirmation.attempts} attempts remaining.`,
      };
    }

    return { success: true, message: 'OTP verified successfully.' };
  } catch (error: any) {
    return { success: false, message: error.message || 'Verification failed.' };
  }
};

/**
 * Regenerate OTP for a delivery
 */
export const regenerateDeliveryOTP = async (
  deliveryId: number,
  phoneNumber: string,
  receiverName?: string
): Promise<{ success: boolean; otp?: string }> => {
  try {
    const newOTP = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const { error } = await supabase
      .from('delivery_confirmations')
      .update({
        system_otp: newOTP,
        otp_expires_at: expiresAt.toISOString(),
        attempts: 0,
        otp_verified: false,
        otp_verified_at: null,
      })
      .eq('delivery_id', deliveryId);

    if (error) throw error;

    await sendDeliveryOTP(phoneNumber, newOTP, deliveryId, receiverName);

    return { success: true, otp: newOTP };
  } catch (error) {
    console.error('Failed to regenerate OTP:', error);
    return { success: false };
  }
};

/**
 * Generate a 6-digit OTP
 */
export const generateOTP = (): string => {
  return String(Math.floor(100000 + Math.random() * 900000));
};