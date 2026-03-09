import { spawn } from 'node:child_process';

const children = [];

const start = (command, args, extraEnv = {}) => {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...extraEnv,
    },
  });
  children.push(child);
  child.on('exit', (code) => {
    if (code && code !== 0) {
      process.exitCode = code;
    }
    for (const candidate of children) {
      if (candidate.pid && !candidate.killed && candidate !== child) {
        candidate.kill('SIGTERM');
      }
    }
  });
};

start('node', ['server/index.ts']);
start('npx', ['vite'], { API_PROXY_TARGET: process.env.API_PROXY_TARGET || 'http://127.0.0.1:4173' });

process.on('SIGINT', () => {
  for (const child of children) {
    if (child.pid && !child.killed) child.kill('SIGINT');
  }
});
