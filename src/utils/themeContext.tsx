// src/utils/themeContext.tsx
import React, {
  createContext, useContext, useState, useEffect, useMemo, useCallback,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'app_theme_mode'; // 'light' | 'dark' | 'system'

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeColors {
  // Surfaces
  background: string;
  card: string;
  cardElevated: string;
  border: string;
  divider: string;

  // Text
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textInverted: string;

  // Status bar
  statusBarStyle: 'light-content' | 'dark-content';

  // Accent (brand, unchanged between themes)
  accent: string;
  accentSoft: string;

  // Semantic
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
  background: '#0B0F14',
  card: '#151A21',
  cardElevated: '#1C232B',
  border: '#232B34',
  divider: '#1F262E',

  textPrimary: '#F3F4F6',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
  textInverted: '#0B0F14',

  statusBarStyle: 'light-content',

  accent: '#F27024',
  accentSoft: '#2A1A0E',

  success: '#34D399',
  successBg: '#0F2A1F',
  warning: '#FBBF24',
  warningBg: '#2A1F0A',
  error: '#F87171',
  errorBg: '#2A1214',
};

interface ThemeContextValue {
  mode: ThemeMode;          // user preference
  isDark: boolean;          // resolved
  colors: ThemeColors;      // resolved palette
  setMode: (mode: ThemeMode) => void;
  toggleDark: () => void;   // flips between light/dark
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('light');

  // Load saved preference once
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

  // For now, 'system' just resolves to light. (You can wire Appearance if you want.)
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
  if (!ctx) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return ctx;
}