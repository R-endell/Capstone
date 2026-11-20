import { requireOptionalNativeModule } from 'expo-modules-core';

type AutoSmsNative = {
  sendSms(phoneNumber: string, message: string): Promise<boolean>;
};

const NativeAutoSms = requireOptionalNativeModule<AutoSmsNative>('AutoSms');

export const isAutoSmsAvailable = (): boolean => NativeAutoSms != null;

export async function sendSilentSms(phoneNumber: string, message: string): Promise<boolean> {
  if (!NativeAutoSms) return false;
  return NativeAutoSms.sendSms(phoneNumber, message);
}