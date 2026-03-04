import { describe, expect, it } from 'vitest';
import { DEFAULT_EDITOR_TYPOGRAPHY, FONT_OPTIONS, sanitizeEditorTypography } from '../../src/services/typography';

describe('sanitizeEditorTypography', () => {
  it('keeps valid values', () => {
    const targetFamily = FONT_OPTIONS[1].value;
    const next = sanitizeEditorTypography({
      fontFamily: targetFamily,
      fontSize: 22,
      lineHeight: 2.1,
      letterSpacing: 1.2,
      contentWidth: 980,
      paragraphSpacing: 1.4,
    });

    expect(next.fontFamily).toBe(targetFamily);
    expect(next.fontSize).toBe(22);
    expect(next.lineHeight).toBe(2.1);
    expect(next.letterSpacing).toBe(1.2);
    expect(next.contentWidth).toBe(980);
    expect(next.paragraphSpacing).toBe(1.4);
  });

  it('clamps out-of-range values and falls back unknown font', () => {
    const next = sanitizeEditorTypography({
      fontFamily: 'unknown-font-family',
      fontSize: 100,
      lineHeight: 10,
      letterSpacing: -5,
      contentWidth: 320,
      paragraphSpacing: 0.1,
    });

    expect(next.fontFamily).toBe(DEFAULT_EDITOR_TYPOGRAPHY.fontFamily);
    expect(next.fontSize).toBe(40);
    expect(next.lineHeight).toBe(2.8);
    expect(next.letterSpacing).toBe(-1);
    expect(next.contentWidth).toBe(560);
    expect(next.paragraphSpacing).toBe(0.4);
  });
});
