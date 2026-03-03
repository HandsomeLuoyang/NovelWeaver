import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [
      react(),
      {
        name: 'api-middleware',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
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
                req.on('data', (chunk) => chunks.push(chunk));
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
          });
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
