import { supabase } from '../utils/supabase';
import {
  PaymentMethod,
  CreatePaymentResponse,
  Payment,
} from '../types/payment';

const EDGE_FUNCTION_URL = process.env.EXPO_PUBLIC_SUPABASE_URL + '/functions/v1';

export const paymentService = {
  // Get user's payment methods
  async getPaymentMethods(): Promise<PaymentMethod[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // ✅ Get user_id safely
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('user_id')
      .eq('auth_id', user.id)
      .single();

    if (userError || !userData) {
      // ✅ Return empty array instead of throwing
      return [];
    }

    const { data, error } = await supabase
      .from('payment_methods')
      .select('*')
      .eq('user_id', userData.user_id)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return data || [];
  },

  // ✅ Check if user already has an active payment method of this type
  async hasActivePaymentMethodType(paymentMethodType: string): Promise<boolean> {
    const methods = await this.getPaymentMethods();
    return methods.some(m => m.payment_method_type === paymentMethodType && m.status === 'active');
  },

  // Create a new payment method (with duplicate check)
  async createPaymentMethod(
    paymentMethodType: string,
    redirectUrl: string
  ): Promise<CreatePaymentResponse> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // ✅ Prevent duplicate active payment methods
    const exists = await this.hasActivePaymentMethodType(paymentMethodType);
    if (exists) {
      throw new Error(`You already have an active ${paymentMethodType} payment method.`);
    }

    const response = await fetch(`${EDGE_FUNCTION_URL}/create-payment-method`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
      },
      body: JSON.stringify({
        payment_method_type: paymentMethodType,
        redirect_url: redirectUrl,
      }),
    });

    const responseData = await response.json();

    if (!response.ok) {
      throw new Error(
        responseData.error ||
        responseData.message ||
        'Failed to create payment method'
      );
    }

    return responseData;
  },

  // Verify payment method after redirect
  async verifyPaymentMethod(paymentMethodId: string): Promise<PaymentMethod> {
    const response = await fetch(`${EDGE_FUNCTION_URL}/verify-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
      },
      body: JSON.stringify({ payment_method_id: paymentMethodId }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to verify payment method');
    }

    return response.json();
  },

  // Delete payment method
  async deletePaymentMethod(paymentMethodId: number): Promise<void> {
    const response = await fetch(`${EDGE_FUNCTION_URL}/delete-payment-method`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
      },
      body: JSON.stringify({ payment_method_id: paymentMethodId }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to delete payment method');
    }
  },

  // Set default payment method
  async setDefaultPaymentMethod(paymentMethodId: number): Promise<void> {
    const response = await fetch(`${EDGE_FUNCTION_URL}/set-default-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
      },
      body: JSON.stringify({ payment_method_id: paymentMethodId }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to set default payment method');
    }
  },

  // Get payment status
  async getPaymentStatus(paymentId: string): Promise<Payment> {
    const response = await fetch(`${EDGE_FUNCTION_URL}/payment-status`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to get payment status');
    }

    return response.json();
  },
};