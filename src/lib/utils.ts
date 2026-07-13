import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type ThemeMode = 'dark' | 'light' | 'auto';

export type ColorPalette = 'graphite' | 'midnight' | 'nordic';

export const DEFAULT_COLOR_PALETTE: ColorPalette = 'graphite';

export const COLOR_PALETTES: readonly ColorPalette[] = [
  'graphite',
  'midnight',
  'nordic',
];

export const PALETTE_TERMINAL_THEMES: Record<ColorPalette, string> = {
  graphite: 'one-dark',
  midnight: 'tokyo-night',
  nordic: 'nord',
};

const APP_SETTINGS_STORAGE_KEY = 'sshClientSettings';

export function normalizeColorPalette(value: unknown): ColorPalette {
  return COLOR_PALETTES.includes(value as ColorPalette)
    ? (value as ColorPalette)
    : DEFAULT_COLOR_PALETTE;
}

export function applyColorPalette(palette: ColorPalette): void {
  document.documentElement.dataset.colorPalette = normalizeColorPalette(palette);
}

export function applyTheme(
  theme: ThemeMode,
  palette: ColorPalette = getSavedColorPalette(),
): void {
  const root = document.documentElement;
  applyColorPalette(palette);
  
  if (theme === 'auto') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.toggle('dark', prefersDark);
  } else {
    root.classList.toggle('dark', theme === 'dark');
  }
}

export function getSavedTheme(): ThemeMode {
  try {
    const settings = localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (settings) {
      const parsed = JSON.parse(settings) as unknown;
      if (parsed && typeof parsed === 'object' && 'theme' in parsed) {
        const { theme } = parsed as { theme?: unknown };
        if (theme === 'dark' || theme === 'light' || theme === 'auto') {
          return theme;
        }
      }
    }
  } catch {
    // Ignore invalid JSON in localStorage
  }
  return 'dark';
}

export function getSavedColorPalette(): ColorPalette {
  try {
    const settings = localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (settings) {
      const parsed = JSON.parse(settings) as unknown;
      if (parsed && typeof parsed === 'object') {
        return normalizeColorPalette((parsed as Record<string, unknown>).colorPalette);
      }
    }
  } catch {
    // Ignore invalid JSON in localStorage
  }
  return DEFAULT_COLOR_PALETTE;
}

export function initializeTheme(): void {
  const theme = getSavedTheme();
  const palette = getSavedColorPalette();
  applyTheme(theme, palette);
  
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    const currentTheme = getSavedTheme();
    if (currentTheme === 'auto') {
      document.documentElement.classList.toggle('dark', e.matches);
    }
  });
}

export function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark');
}

export function getAppTheme(): 'dark' | 'light' {
  return isDarkMode() ? 'dark' : 'light';
}
