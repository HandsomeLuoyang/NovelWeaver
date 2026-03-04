import { describe, expect, it } from 'vitest';
import {
  DARK_THEME_OPTIONS,
  DEFAULT_DARK_THEME_VARIANT,
  DEFAULT_LIGHT_THEME_VARIANT,
  LIGHT_THEME_OPTIONS,
  resolveThemeMode,
  resolveThemeVariant,
  sanitizeDarkThemeVariant,
  sanitizeLightThemeVariant,
  THEME_TOKENS,
} from '../../src/services/theme';

describe('theme service', () => {
  it('resolves system mode according to prefers-color-scheme', () => {
    expect(resolveThemeMode('system', true)).toBe('dark');
    expect(resolveThemeMode('system', false)).toBe('light');
    expect(resolveThemeMode('dark', false)).toBe('dark');
    expect(resolveThemeMode('light', true)).toBe('light');
  });

  it('sanitizes invalid theme variants with defaults', () => {
    expect(sanitizeLightThemeVariant('paper')).toBe('paper');
    expect(sanitizeLightThemeVariant('unknown')).toBe(DEFAULT_LIGHT_THEME_VARIANT);
    expect(sanitizeDarkThemeVariant('forest')).toBe('forest');
    expect(sanitizeDarkThemeVariant(undefined)).toBe(DEFAULT_DARK_THEME_VARIANT);
  });

  it('resolves active variant by resolved mode', () => {
    expect(resolveThemeVariant('light', 'mint', 'graphite')).toBe('mint');
    expect(resolveThemeVariant('dark', 'paper', 'midnight')).toBe('midnight');
  });

  it('ships all palette tokens for every configured option', () => {
    LIGHT_THEME_OPTIONS.forEach((option) => {
      expect(THEME_TOKENS[option.id]).toBeTruthy();
    });
    DARK_THEME_OPTIONS.forEach((option) => {
      expect(THEME_TOKENS[option.id]).toBeTruthy();
    });
  });
});
