# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

织梦机-AI (NovelWeaver-AI) is an AI-assisted long-form novel writing tool based on "fractal recursion" - expanding a simple idea into a complete novel through hierarchical decomposition.

**Core Philosophy**: Start with a single sentence → AI generates worldview, characters, and initial structure → Recursively expand each layer (Volume → Arc → Chapter → Scene) with full context awareness.

## Development Commands

```bash
# Start development server (runs on http://localhost:3000)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Environment Setup

- Create `.env.local` in the root directory
- Set `VITE_GEMINI_API_KEY=your_api_key_here` (or `VITE_OPENAI_API_KEY`)
- Users can also configure custom API keys via the UI (persisted via local API storage and local cache)

## Architecture Overview

### Hierarchical Story Structure

The application uses a 4-level tree structure stored in IndexedDB:

```
Book (id, title, premise, worldSetting, characters[])
 └─ Volume (卷) - Top-level story arcs
     └─ Arc (大剧情) - Major plot segments
         └─ Chapter (章) - Chapter divisions
             └─ Scene (场景) - Leaf nodes with actual content
```

**Critical**: Only `scene` type nodes have a `content` field. Parent nodes only have `title` and `summary` fields.

### Data Flow & State Management

1. **Zustand Store** (`store.ts`): Global state for current book, active node, UI state, and AI model configurations
   - Settings (models, theme) are persisted to `data/local/models.json` via custom Vite middleware
   - Session state (currentBook, activeNodeId) is NOT persisted - intentionally ephemeral

2. **Dexie Database** (`db.ts`): All book and node data stored in IndexedDB (NovelWeaverDB v3)
   - `books` table: Book metadata
   - `nodes` table: Story tree structure with composite index on `[bookId+parentId]`
   - `history` table: Content version history (last 50 versions per node)

3. **Context Assembly**: When drafting a scene, the AI receives:
   - **Macro World**: Book title, worldview, character bios
   - **Structural Context**: Ancestor chain (Volume summary → Arc summary → Chapter summary)
   - **Linear Memory**: Content from previous 3-5 scenes (via `getLinearContext()`)
   - **Current Instruction**: The scene's summary field

### AI Service Layer

`services/geminiService.ts` orchestrates all AI operations:

- **Genesis**: One-sentence idea → Complete book structure with worldview, characters, and initial volumes
- **Expansion**: Parent node → 5-10 child nodes (recursive fractal generation)
- **Drafting**: Scene node + full context → Streaming content generation
- **Polishing**: Selected text → Enhanced rewrite

**Multi-Provider Support**: Supports both Google Gemini (native SDK) and OpenAI-compatible APIs (via fetch). Provider selection is automatic based on model configuration.

### Custom Vite Middleware

The vite.config.ts includes a custom middleware for `/api/storage/*` endpoints:
- GET `/api/storage/models` - Load settings from `data/local/models.json`
- POST `/api/storage/models` - Save settings to `data/local/`
- This enables persistent configuration without a backend server

## Key Implementation Patterns

### Recursive Node Deletion

When deleting a node, use `deleteNodeRecursive()` from `db.ts` to cascade delete all descendants. Never delete a node directly without checking for children.

### Linear Scene Ordering

`getLinearContext()` performs depth-first traversal to build linear scene order across the entire tree. This is crucial for maintaining narrative continuity when drafting new scenes.

### Database Schema Versioning

Current DB version is 3 (see `db.ts`). If modifying types in `types.ts`, increment the version number in the Dexie constructor to trigger migration.

### Model Configuration

The `ModelConfig` interface maps tasks to model IDs:
- `genesisModelId`: World-building (requires strong reasoning)
- `expansionModelId`: Outline generation
- `draftingModelId`: Scene writing (high volume, can use faster models)
- `polishingModelId`: Text refinement

Default models are defined in `store.ts` but users can add custom models via UI.

### AI Prompt Maintenance

All prompts are in `geminiService.ts`. Key considerations:
- Genesis and Expansion require JSON Schema output (use Zod validation)
- Prompts are in Chinese (简体中文) to match the target use case
- OpenAI-compatible providers may need JSON cleanup (strip markdown code blocks)

## Component Responsibilities

- **Library**: Book creation (calls `genesis()`) and book selection
- **Outliner**: Left sidebar - Recursive tree rendering and node expansion (calls `expandNode()`)
- **Editor**: Right sidebar - Scene content drafting (calls `draftScene()`) and polishing (calls `polishText()`)
- **BookSettingsModal**: Edit worldview and character data
- **ModelSettingsModal**: Configure AI models and API keys

## Important Technical Notes

- The `@/*` path alias resolves to the project root directory
- Runtime environment variables use Vite client env (`import.meta.env.VITE_*`)
- History is auto-saved with deduplication (see `saveHistory()` in `db.ts`)
- Word count is calculated from `node.content.length` and stored at book level
- The app has no git repository initialized (as noted in environment info)

## Testing Strategy

The project currently has no test suite. When adding tests, prioritize:
1. Database helpers (`getAncestors`, `getLinearContext`, `deleteNodeRecursive`)
2. AI response parsing and error handling
3. Tree traversal logic in components
