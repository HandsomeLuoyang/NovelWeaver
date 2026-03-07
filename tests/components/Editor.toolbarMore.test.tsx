import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '../../src/components/Editor';
import { useStore } from '../../src/store';
import { createBook, createNode } from '../helpers/fixtures';

const mocks = vi.hoisted(() => ({
  nodeGet: vi.fn(),
  nodeUpdate: vi.fn(),
  getHistory: vi.fn(),
  saveHistory: vi.fn(),
  getLinearContext: vi.fn(),
  getAncestors: vi.fn(),
  getSceneCharacterStates: vi.fn(),
  saveSceneCharacterStates: vi.fn(),
  getSemanticContext: vi.fn(),
  useToast: vi.fn(),
  aiDraft: vi.fn(),
  aiPolish: vi.fn(),
  stopGeneration: vi.fn(),
}));

vi.mock('../../src/db', () => ({
  db: {
    nodes: {
      get: mocks.nodeGet,
      update: mocks.nodeUpdate,
    },
  },
  getLinearContext: mocks.getLinearContext,
  getAncestors: mocks.getAncestors,
  getSceneCharacterStates: mocks.getSceneCharacterStates,
  saveSceneCharacterStates: mocks.saveSceneCharacterStates,
  getSemanticContext: mocks.getSemanticContext,
  saveHistory: mocks.saveHistory,
  getHistory: mocks.getHistory,
}));

vi.mock('../../src/hooks/useAIWriter', () => ({
  useAIWriter: () => ({
    isGenerating: false,
    stopGeneration: mocks.stopGeneration,
    handleAIDraft: mocks.aiDraft,
    handleAIPolish: mocks.aiPolish,
  }),
}));

vi.mock('../../src/hooks/useToast', () => ({
  useToast: () => mocks.useToast(),
}));

vi.mock('../../src/components/BookSettingsModal', () => ({ BookSettingsModal: () => null }));
vi.mock('../../src/components/ChatPanel', () => ({ ChatPanel: () => <div>CHAT_PANEL</div> }));
vi.mock('../../src/components/DraftSettingsModal', () => ({ DraftSettingsModal: () => null }));
vi.mock('../../src/components/ModelSettingsModal', () => ({ ModelSettingsModal: () => null }));
vi.mock('../../src/components/TaskQueueModal', () => ({ TaskQueueModal: () => null }));
vi.mock('../../src/components/ConsistencyCheckModal', () => ({ ConsistencyCheckModal: () => null }));
vi.mock('../../src/components/WritingStats', () => ({ WritingStats: () => <div>WRITING_STATS</div> }));
vi.mock('../../src/components/AIReviewModal', () => ({ AIReviewModal: () => null }));
vi.mock('../../src/components/AIUsagePanel', () => ({ AIUsagePanel: () => <div>USAGE_PANEL</div> }));
vi.mock('../../src/components/CommandPalette', () => ({
  CommandPalette: () => null,
}));
vi.mock('../../src/components/PluginCenterModal', () => ({
  PluginCenterModal: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>PLUGIN_CENTER_MODAL</div> : null),
}));
vi.mock('../../src/components/PublishWorkflowModal', () => ({ PublishWorkflowModal: () => null }));
vi.mock('../../src/components/TypographySettingsModal', () => ({ TypographySettingsModal: () => null }));
vi.mock('../../src/components/PromptManagerModal', () => ({ PromptManagerModal: () => null }));
vi.mock('../../src/components/CreativeRescueModal', () => ({ CreativeRescueModal: () => null }));
vi.mock('../../src/components/ForeshadowManagerModal', () => ({ ForeshadowManagerModal: () => null }));
vi.mock('../../src/components/GlobalSearchReplaceModal', () => ({ GlobalSearchReplaceModal: () => null }));
vi.mock('../../src/components/TimelineBoardModal', () => ({ TimelineBoardModal: () => null }));
vi.mock('../../src/components/CharacterArcBoardModal', () => ({ CharacterArcBoardModal: () => null }));
vi.mock('../../src/components/RewriteWorkbenchModal', () => ({ RewriteWorkbenchModal: () => null }));
vi.mock('../../src/components/MaterialLibraryModal', () => ({ MaterialLibraryModal: () => null }));

describe('Editor toolbar more menu', () => {
  const book = createBook({ id: 'book-editor' });
  const sceneNode = createNode({
    id: 'scene-1',
    bookId: book.id,
    type: 'scene',
    title: '场景一',
    summary: 'summary',
    content: '正文内容',
    status: 'drafted',
    order: 0,
  });
  const initialStoreSlice = {
    currentBook: useStore.getState().currentBook,
    activeNodeId: useStore.getState().activeNodeId,
    expandedNodeIds: useStore.getState().expandedNodeIds,
    isZenMode: useStore.getState().isZenMode,
  };

  beforeEach(() => {
    mocks.nodeGet.mockReset();
    mocks.nodeUpdate.mockReset();
    mocks.getHistory.mockReset();
    mocks.saveHistory.mockReset();
    mocks.getLinearContext.mockReset();
    mocks.getAncestors.mockReset();
    mocks.getSceneCharacterStates.mockReset();
    mocks.saveSceneCharacterStates.mockReset();
    mocks.getSemanticContext.mockReset();
    mocks.stopGeneration.mockReset();
    mocks.aiDraft.mockReset();
    mocks.aiPolish.mockReset();
    mocks.useToast.mockReset();

    mocks.nodeGet.mockResolvedValue(sceneNode);
    mocks.getHistory.mockResolvedValue([]);
    mocks.getSceneCharacterStates.mockResolvedValue([]);
    mocks.getSemanticContext.mockResolvedValue([]);
    mocks.useToast.mockReturnValue({
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
    });

    useStore.setState({
      currentBook: book,
      activeNodeId: sceneNode.id,
      expandedNodeIds: [],
      isZenMode: false,
    });
  });

  afterEach(() => {
    cleanup();
    useStore.setState(initialStoreSlice);
  });

  it('opens toolbar menu and triggers plugin center action', async () => {
    render(<Editor />);

    await waitFor(() => {
      expect(screen.getByText('场景一')).toBeInTheDocument();
    });

    const moreTrigger = screen.getByRole('button', { name: '更多' });
    fireEvent.click(moreTrigger);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '插件中心' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '插件中心' }));

    await waitFor(() => {
      expect(screen.getByText('PLUGIN_CENTER_MODAL')).toBeInTheDocument();
    });
  });
});
