import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RewriteWorkbenchModal } from '../../src/components/RewriteWorkbenchModal';
import { createBook } from '../helpers/fixtures';

const mocks = vi.hoisted(() => ({
  generateRewriteVariants: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('../../src/services/geminiService', () => ({
  generateRewriteVariants: mocks.generateRewriteVariants,
}));

vi.mock('../../src/hooks/useToast', () => ({
  useToast: () => mocks.toast,
}));

describe('RewriteWorkbenchModal', () => {
  beforeEach(() => {
    mocks.generateRewriteVariants.mockReset();
    mocks.toast.success.mockReset();
    mocks.toast.error.mockReset();
    mocks.toast.info.mockReset();
    mocks.toast.warning.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('generates variants and applies selected version', async () => {
    mocks.generateRewriteVariants.mockResolvedValue([
      '改写版本一',
      '改写版本二',
      '改写版本三',
    ]);

    const onApplyVariant = vi.fn();
    render(
      <RewriteWorkbenchModal
        isOpen
        onClose={vi.fn()}
        book={createBook()}
        sourceText="原文片段"
        preContext="前文"
        postContext="后文"
        onApplyVariant={onApplyVariant}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '生成候选' }));

    await waitFor(() => {
      expect(mocks.generateRewriteVariants).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('版本 1')).toBeInTheDocument();
    expect(screen.getAllByText('改写版本一').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '应用此版本' }));
    expect(onApplyVariant).toHaveBeenCalledWith('改写版本一');
  });

  it('warns when source text is empty', async () => {
    render(
      <RewriteWorkbenchModal
        isOpen
        onClose={vi.fn()}
        book={createBook()}
        sourceText="   "
        preContext=""
        postContext=""
        onApplyVariant={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '生成候选' }));

    await waitFor(() => {
      expect(mocks.toast.warning).toHaveBeenCalledWith('当前没有可改写文本');
    });
    expect(mocks.generateRewriteVariants).not.toHaveBeenCalled();
  });
});
