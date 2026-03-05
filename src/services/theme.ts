export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedThemeMode = 'light' | 'dark';

export type LightThemeVariant = 'sunrise' | 'paper' | 'mint' | 'dawn' | 'rose';
export type DarkThemeVariant = 'midnight' | 'forest' | 'graphite' | 'nebula' | 'ember';
export type ThemeVariant = LightThemeVariant | DarkThemeVariant;

export type ThemeTokenKey =
  | 'background'
  | 'foreground'
  | 'card'
  | 'card-foreground'
  | 'popover'
  | 'popover-foreground'
  | 'primary'
  | 'primary-foreground'
  | 'secondary'
  | 'secondary-foreground'
  | 'muted'
  | 'muted-foreground'
  | 'accent'
  | 'accent-foreground'
  | 'destructive'
  | 'destructive-foreground'
  | 'border'
  | 'input'
  | 'ring';

export type ThemeTokenSet = Record<ThemeTokenKey, string>;

export interface ThemePaletteOption<T extends ThemeVariant> {
  id: T;
  mode: ResolvedThemeMode;
  label: string;
  description: string;
  preview: [string, string, string];
}

export const DEFAULT_LIGHT_THEME_VARIANT: LightThemeVariant = 'sunrise';
export const DEFAULT_DARK_THEME_VARIANT: DarkThemeVariant = 'midnight';

export const LIGHT_THEME_OPTIONS: ThemePaletteOption<LightThemeVariant>[] = [
  {
    id: 'sunrise',
    mode: 'light',
    label: '晨曦紫金',
    description: '明亮白底，紫色主按钮，琥珀强调色。',
    preview: ['262 83% 58%', '45 93% 47%', '0 0% 100%'],
  },
  {
    id: 'paper',
    mode: 'light',
    label: '羊皮纸',
    description: '偏暖米色阅读背景，护眼且文字层次柔和。',
    preview: ['30 90% 58%', '170 38% 36%', '38 45% 96%'],
  },
  {
    id: 'mint',
    mode: 'light',
    label: '薄荷工作台',
    description: '清爽青绿调，适合长时间编辑。',
    preview: ['168 76% 34%', '212 83% 46%', '160 25% 97%'],
  },
  {
    id: 'dawn',
    mode: 'light',
    label: '云昼蓝雾',
    description: '雾蓝界面，冷暖平衡，阅读与工具区更克制。',
    preview: ['214 84% 56%', '16 86% 58%', '210 40% 98%'],
  },
  {
    id: 'rose',
    mode: 'light',
    label: '蔷薇纸墨',
    description: '柔和粉白背景，玫红主色，适合灵感型创作。',
    preview: ['336 78% 54%', '212 85% 44%', '336 50% 97%'],
  },
];

export const DARK_THEME_OPTIONS: ThemePaletteOption<DarkThemeVariant>[] = [
  {
    id: 'midnight',
    mode: 'dark',
    label: '午夜紫蓝',
    description: '深海蓝背景，冷色高对比，适合夜间。',
    preview: ['262 83% 65%', '45 93% 55%', '222 47% 4%'],
  },
  {
    id: 'forest',
    mode: 'dark',
    label: '夜林',
    description: '墨绿色背景，视觉刺激更低。',
    preview: ['154 64% 46%', '32 89% 57%', '156 26% 7%'],
  },
  {
    id: 'graphite',
    mode: 'dark',
    label: '石墨青',
    description: '低饱和深灰，青色主按钮，界面克制。',
    preview: ['199 89% 48%', '42 94% 55%', '220 13% 9%'],
  },
  {
    id: 'nebula',
    mode: 'dark',
    label: '星云靛紫',
    description: '深靛星空背景，青紫对比，层次感更强。',
    preview: ['279 89% 68%', '186 91% 48%', '234 38% 8%'],
  },
  {
    id: 'ember',
    mode: 'dark',
    label: '余烬铜夜',
    description: '暖铜主色搭配深夜底色，适合剧情冲突段落。',
    preview: ['24 90% 58%', '196 88% 52%', '18 24% 8%'],
  },
];

const LIGHT_VARIANTS = new Set<LightThemeVariant>(['sunrise', 'paper', 'mint', 'dawn', 'rose']);
const DARK_VARIANTS = new Set<DarkThemeVariant>(['midnight', 'forest', 'graphite', 'nebula', 'ember']);

export const THEME_TOKENS: Record<ThemeVariant, ThemeTokenSet> = {
  sunrise: {
    background: '0 0% 100%',
    foreground: '240 10% 3.9%',
    card: '0 0% 100%',
    'card-foreground': '240 10% 3.9%',
    popover: '0 0% 100%',
    'popover-foreground': '240 10% 3.9%',
    primary: '262 83% 58%',
    'primary-foreground': '0 0% 100%',
    secondary: '240 4.8% 95.9%',
    'secondary-foreground': '240 5.9% 10%',
    muted: '240 4.8% 95.9%',
    'muted-foreground': '240 3.8% 46.1%',
    accent: '45 93% 47%',
    'accent-foreground': '0 0% 100%',
    destructive: '0 84.2% 60.2%',
    'destructive-foreground': '0 0% 98%',
    border: '240 5.9% 90%',
    input: '240 5.9% 90%',
    ring: '262 83% 58%',
  },
  paper: {
    background: '38 45% 96%',
    foreground: '24 22% 16%',
    card: '40 36% 99%',
    'card-foreground': '24 22% 16%',
    popover: '40 36% 99%',
    'popover-foreground': '24 22% 16%',
    primary: '30 90% 58%',
    'primary-foreground': '22 38% 12%',
    secondary: '34 26% 90%',
    'secondary-foreground': '24 22% 20%',
    muted: '35 28% 91%',
    'muted-foreground': '24 13% 38%',
    accent: '170 38% 36%',
    'accent-foreground': '44 54% 95%',
    destructive: '0 75% 54%',
    'destructive-foreground': '0 0% 98%',
    border: '35 21% 84%',
    input: '35 21% 84%',
    ring: '30 90% 58%',
  },
  mint: {
    background: '160 25% 97%',
    foreground: '174 35% 14%',
    card: '160 28% 99%',
    'card-foreground': '174 35% 14%',
    popover: '160 28% 99%',
    'popover-foreground': '174 35% 14%',
    primary: '168 76% 34%',
    'primary-foreground': '0 0% 100%',
    secondary: '165 25% 91%',
    'secondary-foreground': '170 33% 19%',
    muted: '165 22% 92%',
    'muted-foreground': '174 16% 38%',
    accent: '212 83% 46%',
    'accent-foreground': '0 0% 100%',
    destructive: '0 74% 56%',
    'destructive-foreground': '0 0% 100%',
    border: '165 20% 84%',
    input: '165 20% 84%',
    ring: '168 76% 34%',
  },
  dawn: {
    background: '210 40% 98%',
    foreground: '222 40% 14%',
    card: '210 42% 100%',
    'card-foreground': '222 40% 14%',
    popover: '210 42% 100%',
    'popover-foreground': '222 40% 14%',
    primary: '214 84% 56%',
    'primary-foreground': '0 0% 100%',
    secondary: '210 30% 92%',
    'secondary-foreground': '222 35% 22%',
    muted: '210 26% 93%',
    'muted-foreground': '217 14% 40%',
    accent: '16 86% 58%',
    'accent-foreground': '0 0% 100%',
    destructive: '0 72% 54%',
    'destructive-foreground': '0 0% 100%',
    border: '210 23% 84%',
    input: '210 23% 84%',
    ring: '214 84% 56%',
  },
  rose: {
    background: '336 50% 97%',
    foreground: '335 32% 16%',
    card: '336 35% 99%',
    'card-foreground': '335 32% 16%',
    popover: '336 35% 99%',
    'popover-foreground': '335 32% 16%',
    primary: '336 78% 54%',
    'primary-foreground': '0 0% 100%',
    secondary: '336 24% 91%',
    'secondary-foreground': '336 25% 24%',
    muted: '336 22% 92%',
    'muted-foreground': '336 13% 42%',
    accent: '212 85% 44%',
    'accent-foreground': '0 0% 100%',
    destructive: '0 74% 53%',
    'destructive-foreground': '0 0% 100%',
    border: '336 18% 84%',
    input: '336 18% 84%',
    ring: '336 78% 54%',
  },
  midnight: {
    background: '222 47% 4%',
    foreground: '210 40% 98%',
    card: '222 47% 6%',
    'card-foreground': '210 40% 98%',
    popover: '222 47% 4%',
    'popover-foreground': '210 40% 98%',
    primary: '262 83% 65%',
    'primary-foreground': '0 0% 100%',
    secondary: '217 32% 12%',
    'secondary-foreground': '210 40% 98%',
    muted: '217 32% 12%',
    'muted-foreground': '215 20% 65%',
    accent: '45 93% 55%',
    'accent-foreground': '222 47% 4%',
    destructive: '0 72% 51%',
    'destructive-foreground': '210 40% 98%',
    border: '217 32% 14%',
    input: '217 32% 14%',
    ring: '262 83% 65%',
  },
  forest: {
    background: '156 26% 7%',
    foreground: '148 22% 91%',
    card: '156 24% 9%',
    'card-foreground': '148 22% 91%',
    popover: '156 26% 7%',
    'popover-foreground': '148 22% 91%',
    primary: '154 64% 46%',
    'primary-foreground': '156 26% 7%',
    secondary: '158 18% 14%',
    'secondary-foreground': '150 19% 86%',
    muted: '158 18% 14%',
    'muted-foreground': '156 12% 62%',
    accent: '32 89% 57%',
    'accent-foreground': '156 26% 9%',
    destructive: '0 72% 55%',
    'destructive-foreground': '0 0% 98%',
    border: '158 16% 18%',
    input: '158 16% 18%',
    ring: '154 64% 46%',
  },
  graphite: {
    background: '220 13% 9%',
    foreground: '210 20% 94%',
    card: '220 13% 11%',
    'card-foreground': '210 20% 94%',
    popover: '220 13% 9%',
    'popover-foreground': '210 20% 94%',
    primary: '199 89% 48%',
    'primary-foreground': '220 13% 9%',
    secondary: '220 11% 16%',
    'secondary-foreground': '210 16% 88%',
    muted: '220 11% 16%',
    'muted-foreground': '214 10% 63%',
    accent: '42 94% 55%',
    'accent-foreground': '220 13% 9%',
    destructive: '0 72% 56%',
    'destructive-foreground': '210 20% 94%',
    border: '220 9% 22%',
    input: '220 9% 22%',
    ring: '199 89% 48%',
  },
  nebula: {
    background: '234 38% 8%',
    foreground: '224 33% 94%',
    card: '234 32% 11%',
    'card-foreground': '224 33% 94%',
    popover: '234 38% 8%',
    'popover-foreground': '224 33% 94%',
    primary: '279 89% 68%',
    'primary-foreground': '242 38% 10%',
    secondary: '236 22% 16%',
    'secondary-foreground': '224 26% 88%',
    muted: '236 22% 16%',
    'muted-foreground': '226 16% 66%',
    accent: '186 91% 48%',
    'accent-foreground': '236 38% 10%',
    destructive: '0 72% 57%',
    'destructive-foreground': '0 0% 100%',
    border: '235 18% 23%',
    input: '235 18% 23%',
    ring: '279 89% 68%',
  },
  ember: {
    background: '18 24% 8%',
    foreground: '32 22% 93%',
    card: '18 20% 11%',
    'card-foreground': '32 22% 93%',
    popover: '18 24% 8%',
    'popover-foreground': '32 22% 93%',
    primary: '24 90% 58%',
    'primary-foreground': '18 24% 8%',
    secondary: '18 14% 16%',
    'secondary-foreground': '32 18% 86%',
    muted: '18 14% 16%',
    'muted-foreground': '24 12% 64%',
    accent: '196 88% 52%',
    'accent-foreground': '18 24% 8%',
    destructive: '0 74% 58%',
    'destructive-foreground': '0 0% 100%',
    border: '18 12% 24%',
    input: '18 12% 24%',
    ring: '24 90% 58%',
  },
};

export const resolveThemeMode = (mode: ThemeMode, prefersDark: boolean): ResolvedThemeMode => (
  mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode
);

export const sanitizeLightThemeVariant = (value: unknown): LightThemeVariant => (
  typeof value === 'string' && LIGHT_VARIANTS.has(value as LightThemeVariant)
    ? (value as LightThemeVariant)
    : DEFAULT_LIGHT_THEME_VARIANT
);

export const sanitizeDarkThemeVariant = (value: unknown): DarkThemeVariant => (
  typeof value === 'string' && DARK_VARIANTS.has(value as DarkThemeVariant)
    ? (value as DarkThemeVariant)
    : DEFAULT_DARK_THEME_VARIANT
);

export const resolveThemeVariant = (
  mode: ResolvedThemeMode,
  lightVariant: LightThemeVariant,
  darkVariant: DarkThemeVariant
): ThemeVariant => (mode === 'dark' ? darkVariant : lightVariant);
