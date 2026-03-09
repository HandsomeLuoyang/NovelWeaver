import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const createStorageMiddleware = () => {
  return async (req: any, res: any, next: any) => {
    if (req.url?.startsWith('/api/storage/')) {
      const key = req.url.split('/').pop();
      const localDataDir = path.join(__dirname, 'data', 'local');
      const localPath = path.join(localDataDir, `${key}.json`);

      if (req.method === 'GET') {
        try {
          const fs = await import('fs/promises');
          const localExists = await fs
            .access(localPath)
            .then(() => true)
            .catch(() => false);

          if (localExists) {
            const data = await fs.readFile(localPath, 'utf-8');
            res.setHeader('Content-Type', 'application/json');
            res.end(data);
          } else {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'File not found' }));
          }
        } catch (e) {
          console.error(e);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'Internal Server Error' }));
        }
        return;
      }

      if (req.method === 'POST') {
        const chunks: any[] = [];
        req.on('data', (chunk: any) => chunks.push(chunk));
        req.on('end', async () => {
          try {
            const body = Buffer.concat(chunks).toString();
            const fs = await import('fs/promises');
            await fs.mkdir(localDataDir, { recursive: true });
            await fs.writeFile(localPath, body);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true }));
          } catch (e) {
            console.error(e);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
          }
        });
        return;
      }
    }
    next();
  };
};

export default defineConfig(({ mode }) => {
  const proxyTarget = process.env.API_PROXY_TARGET?.trim();
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
      ...(proxyTarget ? {
        proxy: {
          '/api': {
            target: proxyTarget,
            changeOrigin: true,
          },
        },
      } : {}),
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react-vendor';
            if (id.includes('node_modules/dexie')) return 'data-vendor';
            if (id.includes('node_modules/zustand') || id.includes('node_modules/zod') || id.includes('node_modules/uuid')) return 'state-vendor';
            if (id.includes('node_modules/react-markdown') || id.includes('node_modules/remark-gfm')) return 'markdown-vendor';
            if (id.includes('node_modules/@google/genai') || id.includes('node_modules/diff')) return 'ai-vendor';
            if (id.includes('node_modules/docx') || id.includes('node_modules/fflate')) return 'export-vendor';
            if (id.includes('node_modules/framer-motion') || id.includes('node_modules/lucide-react')) return 'ui-vendor';
            return undefined;
          },
        },
      },
    },
    plugins: [
      react(),
      ...(!proxyTarget ? [{
        name: 'api-middleware',
        configureServer(server) {
          server.middlewares.use(createStorageMiddleware());
        },
        configurePreviewServer(server) {
          server.middlewares.use(createStorageMiddleware());
        },
      }] : []),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      }
    }
  };
});
