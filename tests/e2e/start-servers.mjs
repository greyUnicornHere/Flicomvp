// Starts the API and web dev servers for E2E tests with a fresh database.
import { rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';

rmSync(dirname(process.env.DATABASE_PATH), { recursive: true, force: true });
const child = spawn('npm', ['run', 'dev'], { stdio: 'inherit', shell: true, env: process.env });
const stop = () => child.kill('SIGTERM');
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('exit', (code) => process.exit(code ?? 0));
