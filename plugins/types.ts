import { Book, StoryNode } from '../types';

export interface PluginRunContext {
  currentBook: Book | null;
  currentNode: StoryNode | null;
  selectedText: string;
}

export interface PluginRunResult {
  message: string;
}

export interface PluginAction {
  id: string;
  title: string;
  description?: string;
  run: (context: PluginRunContext) => Promise<PluginRunResult | void> | PluginRunResult | void;
}

export interface NovelWeaverPlugin {
  id: string;
  name: string;
  version: string;
  description?: string;
  actions: PluginAction[];
}
