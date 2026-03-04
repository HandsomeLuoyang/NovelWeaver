import { describe, expect, it } from 'vitest';
import {
  clonePromptProfile,
  createDefaultPromptProfile,
  normalizePromptProfiles,
  renderPrompt,
  validatePromptTemplate,
} from '../../src/services/promptProfiles';

describe('promptProfiles utilities', () => {
  it('returns independent default template objects', () => {
    const first = createDefaultPromptProfile();
    first.templates.genesis.systemPrompt = 'changed';

    const second = createDefaultPromptProfile();
    expect(second.templates.genesis.systemPrompt).not.toBe('changed');
  });

  it('renders placeholders and falls back missing vars to empty string', () => {
    const rendered = renderPrompt('A={{a}} B={{b}} C={{c}}', { a: '1', b: 2 });
    expect(rendered).toBe('A=1 B=2 C=');
  });

  it('adds builtin default profile when missing', () => {
    const custom = createDefaultPromptProfile();
    custom.id = 'custom';
    custom.name = 'custom';
    custom.isBuiltin = false;

    const normalized = normalizePromptProfiles([custom]);
    expect(normalized.some((profile) => profile.id === 'prompt-default')).toBe(true);
  });

  it('clones profile into editable non-builtin copy', () => {
    const source = createDefaultPromptProfile();
    const cloned = clonePromptProfile(source, 'my copy');

    expect(cloned.id).not.toBe(source.id);
    expect(cloned.name).toBe('my copy');
    expect(cloned.isBuiltin).toBe(false);
    expect(cloned.templates.genesis.userPrompt).toBe(source.templates.genesis.userPrompt);
  });

  it('validates missing required variables', () => {
    const missing = validatePromptTemplate('drafting', {
      systemPrompt: '你是写作助手',
      userPrompt: '只保留 {{bookTitle}} 和 {{nodeTitle}}',
    });

    expect(missing).toContain('hierarchyContext');
    expect(missing).toContain('nodeSummary');
  });
});
