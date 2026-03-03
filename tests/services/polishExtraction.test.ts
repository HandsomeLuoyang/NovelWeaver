import { describe, expect, it } from 'vitest';
import { extractPolishedSegment } from '../../services/polishUtils';

describe('extractPolishedSegment', () => {
  it('extracts text wrapped in POLISHED tags', () => {
    const raw = `一些解释
<POLISHED>
这是润色后的正文。
</POLISHED>`;
    expect(extractPolishedSegment(raw)).toBe('这是润色后的正文。');
  });

  it('falls back to plain body when tags are missing', () => {
    const raw = '这是直接返回的润色文本。';
    expect(extractPolishedSegment(raw)).toBe('这是直接返回的润色文本。');
  });

  it('removes markdown code fences', () => {
    const raw = '```text\n润色片段\n```';
    expect(extractPolishedSegment(raw)).toBe('润色片段');
  });
});
