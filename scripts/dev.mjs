// Runs API (auto-restart) + Vite dev server together.
import { spawn } from 'node:child_process';

const run = (cmd, args) =>
  spawn(cmd, args, { stdio: 'inherit', shell: true });

const api = run('node', ['--watch', 'server/index.js']);
const web = run('npx', ['vite', 'client', '--host']);

const stop = () => { api.kill(); web.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
