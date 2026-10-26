// src/types/payment.ts
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

/* ------------------------------------------------------------------ */
/* Provider Wallet & Payouts v3 Cashout Types                          */
/* ------------------------------------------------------------------ */
export type WithdrawalStatus =
  | 'Pending'
  | 'Processing'
  | 'Pending_Compliance'
  | 'Completed'
  | 'Failed'
  | 'Rejected'
  | 'Reversed';

export interface ProviderWallet {
  wallet_id: number;
  provider_id: number;
  balance: number;
  gcash_number: string | null;
  maya_number?: string | null;
  bank_name: string | null;
  bank_acc_number: string | null;
  bank_acc_holder: string | null;
  updated_at: string;
}

export interface WithdrawalRequest {
  withdrawal_id: number;
  provider_wallet_id: number;
  amount: number;
  method: PaymentProvider | string;
  status: WithdrawalStatus;
  requested_at: string;
  processed_at: string | null;
  account_number: string | null;
  account_holder_name: string | null;
  idempotency_key: string | null;
  xendit_reference_id: string | null;
  xendit_payout_id: string | null;
  xendit_status: string | null;
  failure_code: string | null;
  failure_message: string | null;
  balance_before: number | null;
  balance_after: number | null;
  wallet_debited_at: string | null;
  wallet_refunded_at: string | null;
  reversed_at: string | null;
  updated_at?: string;
}

export interface RequestCashoutPayload {
  amount: number;
  method: PaymentProvider;
  accountNumber: string;
  accountHolderName: string;
  idempotencyKey: string;
  saveDestination?: boolean;
}

export interface RequestCashoutResponse {
  success: boolean;
  withdrawal: WithdrawalRequest & { wallet_balance?: number };
  idempotent_replay?: boolean;
  pending_reconciliation?: boolean;
  message?: string;
}