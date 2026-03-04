import { EditorTypographySettings } from '../types';

export interface FontOption {
  id: string;
  label: string;
  value: string;
}

export const FONT_OPTIONS: FontOption[] = [
  {
    id: 'songti',
    label: '宋体风格',
    value: '"Songti SC", "STSong", "Noto Serif SC", "Source Han Serif SC", serif',
  },
  {
    id: 'kaiti',
    label: '楷体风格',
    value: '"Kaiti SC", "STKaiti", "KaiTi", "Noto Serif SC", serif',
  },
  {
    id: 'heiti',
    label: '黑体风格',
    value: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif',
  },
  {
    id: 'wenkai',
    label: '文楷风格',
    value: '"LXGW WenKai", "Kaiti SC", "STKaiti", serif',
  },
  {
    id: 'mono',
    label: '等宽风格',
    value: '"JetBrains Mono", "SFMono-Regular", Menlo, Monaco, Consolas, monospace',
  },
];

export const DEFAULT_EDITOR_TYPOGRAPHY: EditorTypographySettings = {
  fontFamily: FONT_OPTIONS[0].value,
  fontSize: 20,
  lineHeight: 1.9,
  letterSpacing: 0.2,
  contentWidth: 820,
  paragraphSpacing: 1.15,
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const toNumber = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const round = (value: number, digits: number) => {
  const precision = 10 ** digits;
  return Math.round(value * precision) / precision;
};

export const sanitizeEditorTypography = (
  incoming: Partial<EditorTypographySettings>,
): EditorTypographySettings => {
  const family = typeof incoming.fontFamily === 'string' ? incoming.fontFamily.trim() : '';
  const isKnownFamily = FONT_OPTIONS.some((option) => option.value === family);

  return {
    fontFamily: isKnownFamily ? family : DEFAULT_EDITOR_TYPOGRAPHY.fontFamily,
    fontSize: clamp(round(toNumber(incoming.fontSize, DEFAULT_EDITOR_TYPOGRAPHY.fontSize), 1), 12, 40),
    lineHeight: clamp(round(toNumber(incoming.lineHeight, DEFAULT_EDITOR_TYPOGRAPHY.lineHeight), 2), 1.2, 2.8),
    letterSpacing: clamp(round(toNumber(incoming.letterSpacing, DEFAULT_EDITOR_TYPOGRAPHY.letterSpacing), 2), -1, 6),
    contentWidth: clamp(Math.round(toNumber(incoming.contentWidth, DEFAULT_EDITOR_TYPOGRAPHY.contentWidth)), 560, 1600),
    paragraphSpacing: clamp(round(toNumber(incoming.paragraphSpacing, DEFAULT_EDITOR_TYPOGRAPHY.paragraphSpacing), 2), 0.4, 3),
  };
};
