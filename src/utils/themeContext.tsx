// src/utils/themeContext.tsx
import React, {
  createContext, useContext, useState, useEffect, useMemo, useCallback,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'app_theme_mode'; 

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeColors {
  background: string;
  card: string;
  cardElevated: string;
  border: string;
  divider: string;

  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textInverted: string;

  statusBarStyle: 'light-content' | 'dark-content';

  accent: string;
  accentSoft: string;

  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  error: string;
  errorBg: string;
}

const LIGHT: ThemeColors = {
  background: '#F9FAFB',
  card: '#FFFFFF',
  cardElevated: '#FFFFFF',
  border: '#E5E7EB',
  divider: '#F3F4F6',
  textPrimary: '#111827',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  textInverted: '#FFFFFF',
  statusBarStyle: 'dark-content',
  accent: '#F27024',
  accentSoft: '#FFF7ED',
  success: '#10B981',
  successBg: '#ECFDF5',
  warning: '#F59E0B',
  warningBg: '#FFFBEB',
  error: '#EF4444',
  errorBg: '#FEF2F2',
};

const DARK: ThemeColors = {
  // Matched to screenshot: Deep Navy Background & Slate Cards
  background: '#0B1120', 
  card: '#111827',       
  cardElevated: '#1F2937', 
  border: '#1F2937',     
  divider: '#374151',

  textPrimary: '#F9FAFB',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
  textInverted: '#0B1120',

  statusBarStyle: 'light-content',

  accent: '#F27024', // Your brand orange
  accentSoft: '#2A1A0E',

  // Matched to screenshot: Pill badges
  success: '#34D399', // Bright green text
  successBg: '#064E3B', // Dark green background
  warning: '#FBBF24', 
  warningBg: '#2A1F0A',
  error: '#F87171', // Bright red text
  errorBg: '#7F1D1D', // Dark red background
};

interface ThemeContextValue {
  mode: ThemeMode;
  isDark: boolean;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => void;
  toggleDark: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('light');

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setModeState(stored);
        }
      } catch {}
    })();
  }, []);

  const setMode = useCallback(async (next: ThemeMode) => {
    setModeState(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }, []);

  const toggleDark = useCallback(() => {
    setModeState((prev) => {
      const next: ThemeMode = prev === 'dark' ? 'light' : 'dark';
      AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  const isDark = mode === 'dark';
  const colors = useMemo(() => (isDark ? DARK : LIGHT), [isDark]);

  const value = useMemo(
    () => ({ mode, isDark, colors, setMode, toggleDark }),
    [mode, isDark, colors, setMode, toggleDark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}