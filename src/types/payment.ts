export type PaymentMethodType = 'gcash' | 'maya' | 'card' | 'online_banking';

export interface PaymentMethod {
  id: number;
  user_id: number;
  provider: string;
  payment_method_type: PaymentMethodType;
  paymongo_payment_method_id: string | null;
  paymongo_payment_intent_id: string | null; // ✅ Add this
  display_name: string | null;
  last_four_digits: string | null;
  expiry_month: string | null;
  expiry_year: string | null;
  is_default: boolean;
  status: 'active' | 'inactive' | 'pending';
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: number;
  user_id: number;
  booking_id: number | null;
  payment_method_id: number | null;
  amount: number;
  currency: string;
  paymongo_payment_intent_id: string | null;
  paymongo_payment_id: string | null;
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled' | 'refunded';
  failure_reason: string | null;
  metadata: any;
  created_at: string;
  updated_at: string;
}

export interface CreatePaymentMethodRequest {
  payment_method_type: PaymentMethodType;
  redirect_url: string;
}

export interface CreatePaymentResponse {
  payment_method_id: number;
  paymongo_payment_method_id: string;
  redirect_url?: string;
  requires_action: boolean;
}

export interface PaymentMethodDisplayInfo {
  type: PaymentMethodType;
  label: string;
  icon: string;
  description: string;
}