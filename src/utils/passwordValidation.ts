// src/utils/passwordValidation.ts
export type PasswordStrength = {
  minLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSpecial: boolean;
};

export const checkPasswordStrength = (password: string): PasswordStrength => ({
  minLength: password.length >= 8,
  hasUppercase: /[A-Z]/.test(password),
  hasLowercase: /[a-z]/.test(password),
  hasNumber: /[0-9]/.test(password),
  hasSpecial: /[!@#$%^&*]/.test(password),
});

export const validatePassword = (password: string): string => {
  if (!password) return 'Password is required';
  const s = checkPasswordStrength(password);
  if (!s.minLength) return 'At least 8 characters';
  if (!s.hasUppercase) return 'Include at least 1 uppercase letter';
  if (!s.hasLowercase) return 'Include at least 1 lowercase letter';
  if (!s.hasNumber) return 'Include at least 1 number';
  if (!s.hasSpecial) return 'Include at least 1 special character (!@#$%^&*)';
  return '';
};

export const validateConfirmPassword = (password: string, confirm: string): string => {
  if (!confirm) return 'Please confirm your password';
  if (password !== confirm) return 'Passwords do not match';
  return '';
};

export const validateEmail = (email: string): string => {
  if (!email) return 'Email is required';
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!re.test(email)) return 'Please enter a valid email address';
  return '';
};