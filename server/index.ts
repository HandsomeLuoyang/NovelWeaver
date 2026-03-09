import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import type { AIModel } from '../src/types.ts';
import type { AgentRun, AgentToolInvokeRequest } from '../shared/agent.ts';
import { invokeTool, TOOL_DEFINITIONS } from './tools.ts';
import {
  createAgentToken,
  getAgentRun,
  getAgentTokenByPlainToken,
  getAiTask,
  getContentSnapshot,
  getSettingsSnapshot,
  listAgentRuns,
  listAgentTokens,
  listAiTasks,
  listReviewItems,
  saveAgentRun,
  saveAiTask,
  saveSettingsSnapshot,
  updateReviewItemStatus,
  withContentMutation,
} from './store.ts';
import { executeAITask } from './ai.ts';
import { testModelAvailabilityOnServer } from './probe.ts';
import {
  buildDocxBufferFromBundle,
  buildEpubBufferFromBundle,
  buildHtmlFromBundle,
  buildMarkdownFromBundle,
  buildTextFromBundle,
} from './export.ts';
import { findBook, getBookCharacterStates, getBookFacts, getBookMaterials, getBookNodes, createCheckpoint } from './store.ts';

const HOST = process.env.HOST || process.env.AGENT_HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || process.env.AGENT_SERVER_PORT || 4173);
const DIST_DIR = path.resolve(process.cwd(), 'dist');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const sendJson = (res: ServerResponse, statusCode: number, payload: unknown) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  });
  res.end(JSON.stringify(payload));
};

const sendText = (res: ServerResponse, statusCode: number, payload: string, contentType = 'text/plain; charset=utf-8') => {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(payload);
};

const readBody = async (req: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const readAuth = (req: IncomingMessage) => {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  if (!token) return null;
  return getAgentTokenByPlainToken(token);
};

const requireAgentAuth = (req: IncomingMessage, res: ServerResponse) => {
  const token = readAuth(req);
  if (!token) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return null;
  }
  return {
    actorType: 'agent' as const,
    actorId: token.id,
    scopes: token.scopes,
  };
};

const sendSse = (res: ServerResponse, event: string, payload: unknown) => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const handleTaskSse = (res: ServerResponse, taskId: string) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const sendSnapshot = () => {
    const task = getAiTask(taskId);
    if (!task) {
      sendSse(res, 'error', { error: 'Task not found' });
      res.end();
      return;
    }
    sendSse(res, 'snapshot', task);
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      res.end();
    }
  };

  sendSnapshot();
  const timer = setInterval(sendSnapshot, 1000);
  res.on('close', () => clearInterval(timer));
};

const handleRunSse = (res: ServerResponse, runId: string) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const sendSnapshot = () => {
    const run = getAgentRun(runId);
    if (!run) {
      sendSse(res, 'error', { error: 'Run not found' });
      res.end();
      return;
    }
    sendSse(res, 'snapshot', run);
    if (run.status === 'completed' || run.status === 'failed') {
      res.end();
    }
  };

  sendSnapshot();
  const timer = setInterval(sendSnapshot, 1000);
  res.on('close', () => clearInterval(timer));
};

const executeAiTaskRecord = async (taskId: string) => {
  const task = getAiTask(taskId);
  if (!task) return null;
  saveAiTask({ ...task, status: 'running', updatedAt: Date.now() });
  try {
    const result = await executeAITask(getContentSnapshot(), getSettingsSnapshot(), task.request as never);
    const completed = { ...task, status: 'completed' as const, result, updatedAt: Date.now() };
    saveAiTask(completed);
    return completed;
  } catch (error) {
    const failed = {
      ...task,
      status: 'failed' as const,
      error: error instanceof Error ? error.message : String(error),
      updatedAt: Date.now(),
    };
    saveAiTask(failed);
    return failed;
  }
};

const serveStatic = (req: IncomingMessage, res: ServerResponse, pathname: string) => {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(DIST_DIR, safePath);

  const resolvedPath = fs.existsSync(filePath) && fs.statSync(filePath).isFile()
    ? filePath
    : path.join(DIST_DIR, 'index.html');

  if (!fs.existsSync(resolvedPath)) {
    sendText(res, 404, 'Not Found');
    return;
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable',
  });
  fs.createReadStream(resolvedPath).pipe(res);
};

const server = createServer(async (req, res) => {
  if (!req.url || !req.method) {
    sendJson(res, 400, { error: 'Bad Request' });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname, searchParams } = url;

  try {
    if (pathname === '/api/v1/health' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        service: 'agent-ready-backend',
        storage: 'sqlite',
        tools: TOOL_DEFINITIONS.length,
      });
      return;
    }

    if ((pathname === '/api/storage/content' || pathname === '/api/v1/storage/content') && req.method === 'GET') {
      sendJson(res, 200, getContentSnapshot());
      return;
    }

    if ((pathname === '/api/storage/content' || pathname === '/api/v1/storage/content') && req.method === 'POST') {
      const body = await readBody(req);
      const { snapshot } = withContentMutation((current) => {
        Object.assign(current, body);
        return true;
      });
      sendJson(res, 200, snapshot);
      return;
    }

    if ((pathname === '/api/storage/models' || pathname === '/api/v1/storage/models') && req.method === 'GET') {
      sendJson(res, 200, getSettingsSnapshot());
      return;
    }

    if ((pathname === '/api/storage/models' || pathname === '/api/v1/storage/models') && req.method === 'POST') {
      const body = await readBody(req);
      sendJson(res, 200, saveSettingsSnapshot(body as never));
      return;
    }

    if (pathname === '/api/v1/books' && req.method === 'GET') {
      const snapshot = getContentSnapshot();
      sendJson(res, 200, { books: snapshot.books });
      return;
    }

    const bookTreeMatch = pathname.match(/^\/api\/v1\/books\/([^/]+)\/tree$/);
    if (bookTreeMatch && req.method === 'GET') {
      const bookId = decodeURIComponent(bookTreeMatch[1]);
      const snapshot = getContentSnapshot();
      const book = findBook(snapshot, bookId);
      if (!book) {
        sendJson(res, 404, { error: 'Book not found' });
        return;
      }
      sendJson(res, 200, {
        book,
        nodes: getBookNodes(snapshot, bookId),
        facts: getBookFacts(snapshot, bookId),
        materials: getBookMaterials(snapshot, bookId),
        characterStates: getBookCharacterStates(snapshot, bookId),
        checkpoints: snapshot.checkpoints.filter((entry) => entry.bookId === bookId),
      });
      return;
    }

    const bookSnapshotMatch = pathname.match(/^\/api\/v1\/books\/([^/]+)\/snapshot$/);
    if (bookSnapshotMatch && req.method === 'GET') {
      const bookId = decodeURIComponent(bookSnapshotMatch[1]);
      const snapshot = getContentSnapshot();
      const book = findBook(snapshot, bookId);
      if (!book) {
        sendJson(res, 404, { error: 'Book not found' });
        return;
      }
      sendJson(res, 200, {
        book,
        nodes: getBookNodes(snapshot, bookId),
        facts: getBookFacts(snapshot, bookId),
        materials: getBookMaterials(snapshot, bookId),
        characterStates: getBookCharacterStates(snapshot, bookId),
        foreshadows: snapshot.foreshadows.filter((entry) => entry.bookId === bookId),
        references: snapshot.references.filter((entry) => entry.bookId === bookId),
        checkpoints: snapshot.checkpoints.filter((entry) => entry.bookId === bookId),
      });
      return;
    }

    if (pathname === '/api/v1/reviews' && req.method === 'GET') {
      const bookId = searchParams.get('bookId') || undefined;
      sendJson(res, 200, { items: listReviewItems(bookId || undefined) });
      return;
    }

    const reviewApplyMatch = pathname.match(/^\/api\/v1\/reviews\/([^/]+)\/(apply|discard)$/);
    if (reviewApplyMatch && req.method === 'POST') {
      const actor = { actorType: 'ui' as const, actorId: 'ui', scopes: TOOL_DEFINITIONS.flatMap((tool) => tool.scopes) };
      const reviewId = decodeURIComponent(reviewApplyMatch[1]);
      const action = reviewApplyMatch[2];
      if (action === 'apply') {
        const result = await invokeTool('write.apply_review_item', { args: { reviewId } }, { actor });
        sendJson(res, 200, result);
        return;
      }
      const item = updateReviewItemStatus(reviewId, 'discarded');
      sendJson(res, 200, { item });
      return;
    }

    if (pathname === '/api/v1/checkpoints' && req.method === 'POST') {
      const body = await readBody(req);
      const actor = { actorType: 'ui' as const, actorId: 'ui', scopes: TOOL_DEFINITIONS.flatMap((tool) => tool.scopes) };
      const result = await invokeTool('ops.create_checkpoint', { args: body }, { actor });
      sendJson(res, 200, result);
      return;
    }

    if (pathname === '/api/v1/exports' && req.method === 'POST') {
      const body = await readBody(req);
      const actor = { actorType: 'ui' as const, actorId: 'ui', scopes: TOOL_DEFINITIONS.flatMap((tool) => tool.scopes) };
      const result = await invokeTool('ops.export_book', { args: body, returnMode: 'full' }, { actor });
      sendJson(res, 200, result);
      return;
    }

    if (pathname === '/api/v1/models' && req.method === 'GET') {
      const settings = getSettingsSnapshot().state as { models?: AIModel[]; modelConfig?: unknown };
      const models = (settings.models || []).map((model) => ({
        ...model,
        apiKey: model.apiKey ? '***' : '',
        hasApiKey: Boolean(model.apiKey || process.env.VITE_GEMINI_API_KEY || process.env.VITE_OPENAI_API_KEY || process.env.VITE_API_KEY),
      }));
      sendJson(res, 200, { models, modelConfig: settings.modelConfig || null });
      return;
    }

    if (pathname === '/api/v1/models/test' && req.method === 'POST') {
      const body = await readBody(req);
      const model = body.model as AIModel;
      if (!model) {
        sendJson(res, 400, { error: 'Missing model payload' });
        return;
      }
      const result = await testModelAvailabilityOnServer(model);
      sendJson(res, 200, result);
      return;
    }

    if (pathname === '/api/v1/ai/tasks' && req.method === 'GET') {
      sendJson(res, 200, { tasks: listAiTasks() });
      return;
    }

    if (pathname === '/api/v1/ai/tasks' && req.method === 'POST') {
      const body = await readBody(req);
      const taskId = randomUUID();
      const task = saveAiTask({
        id: taskId,
        taskType: String(body.taskType || ''),
        status: 'pending',
        bookId: body.input && typeof body.input === 'object' && 'bookId' in body.input ? String((body.input as Record<string, unknown>).bookId || '') || undefined : undefined,
        nodeId: body.input && typeof body.input === 'object' && 'nodeId' in body.input ? String((body.input as Record<string, unknown>).nodeId || '') || undefined : undefined,
        request: {
          taskType: body.taskType,
          input: body.input && typeof body.input === 'object' ? body.input : {},
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const wait = body.wait !== false;
      if (wait) {
        const completed = await executeAiTaskRecord(taskId);
        sendJson(res, 200, completed);
        return;
      }

      void executeAiTaskRecord(taskId);
      sendJson(res, 202, task);
      return;
    }

    const aiTaskMatch = pathname.match(/^\/api\/v1\/ai\/tasks\/([^/]+)$/);
    if (aiTaskMatch && req.method === 'GET') {
      const task = getAiTask(decodeURIComponent(aiTaskMatch[1]));
      if (!task) {
        sendJson(res, 404, { error: 'Task not found' });
        return;
      }
      sendJson(res, 200, task);
      return;
    }

    const aiTaskEventsMatch = pathname.match(/^\/api\/v1\/ai\/tasks\/([^/]+)\/events$/);
    if (aiTaskEventsMatch && req.method === 'GET') {
      handleTaskSse(res, decodeURIComponent(aiTaskEventsMatch[1]));
      return;
    }

    if (pathname === '/api/v1/agent/tools' && req.method === 'GET') {
      const actor = requireAgentAuth(req, res);
      if (!actor) return;
      sendJson(res, 200, { tools: TOOL_DEFINITIONS.filter((tool) => tool.scopes.every((scope) => actor.scopes.includes(scope))) });
      return;
    }

    const agentToolMatch = pathname.match(/^\/api\/v1\/agent\/tools\/(.+)$/);
    if (agentToolMatch && req.method === 'POST') {
      const actor = requireAgentAuth(req, res);
      if (!actor) return;
      const body = await readBody(req);
      const toolName = decodeURIComponent(agentToolMatch[1]);
      const result = await invokeTool(toolName, body as AgentToolInvokeRequest, { actor });
      sendJson(res, 200, result);
      return;
    }

    if (pathname === '/api/v1/agent/runs' && req.method === 'GET') {
      const actor = requireAgentAuth(req, res);
      if (!actor) return;
      sendJson(res, 200, { runs: listAgentRuns() });
      return;
    }

    if (pathname === '/api/v1/agent/runs' && req.method === 'POST') {
      const actor = requireAgentAuth(req, res);
      if (!actor) return;
      const body = await readBody(req);
      const run: AgentRun = {
        id: randomUUID(),
        goal: String(body.goal || ''),
        caller: String(body.caller || 'manual') as AgentRun['caller'],
        status: 'running',
        steps: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      saveAgentRun(run);
      sendJson(res, 201, run);
      return;
    }

    const agentRunMatch = pathname.match(/^\/api\/v1\/agent\/runs\/([^/]+)$/);
    if (agentRunMatch && req.method === 'GET') {
      const actor = requireAgentAuth(req, res);
      if (!actor) return;
      const run = getAgentRun(decodeURIComponent(agentRunMatch[1]));
      if (!run) {
        sendJson(res, 404, { error: 'Run not found' });
        return;
      }
      sendJson(res, 200, run);
      return;
    }

    const agentRunEventsMatch = pathname.match(/^\/api\/v1\/agent\/runs\/([^/]+)\/events$/);
    if (agentRunEventsMatch && req.method === 'GET') {
      const actor = requireAgentAuth(req, res);
      if (!actor) return;
      handleRunSse(res, decodeURIComponent(agentRunEventsMatch[1]));
      return;
    }

    if (pathname === '/api/v1/agent/tokens' && req.method === 'GET') {
      const actor = requireAgentAuth(req, res);
      if (!actor) return;
      if (!actor.scopes.includes('models.admin')) {
        sendJson(res, 403, { error: 'Forbidden' });
        return;
      }
      sendJson(res, 200, { tokens: listAgentTokens() });
      return;
    }

    if (pathname === '/api/v1/agent/tokens' && req.method === 'POST') {
      const actor = requireAgentAuth(req, res);
      if (!actor) return;
      if (!actor.scopes.includes('models.admin')) {
        sendJson(res, 403, { error: 'Forbidden' });
        return;
      }
      const body = await readBody(req);
      const name = String(body.name || 'Agent Token');
      const scopes = Array.isArray(body.scopes) ? body.scopes.map((scope) => String(scope)) as any : [];
      const token = createAgentToken(name, scopes);
      sendJson(res, 201, token);
      return;
    }

    if (pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'Not Found' });
      return;
    }

    serveStatic(req, res, pathname);
  } catch (error) {
    console.error(error);
    const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number((error as { statusCode?: number }).statusCode) || 500 : 500;
    sendJson(res, statusCode, { error: error instanceof Error ? error.message : 'Internal Server Error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[agent-backend] listening on http://${HOST}:${PORT}`);
});
