export type PaymentProvider = 'gcash' | 'maya';

export interface PaymentMethod {
  id: number;
  user_id: number;
  provider: PaymentProvider;
  payment_token_id: string;
  is_default: boolean;
  linked_at: string;
}

export interface CreateSessionResponse {
  payment_link_url: string;
}