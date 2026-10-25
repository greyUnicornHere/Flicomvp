// First-time setup: create .env from .env.example (if missing) and apply database migrations.
import { copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (existsSync('.env')) {
  console.log('✓ .env already exists — leaving it unchanged.');
} else {
  copyFileSync('.env.example', '.env');
  console.log('✓ Created .env from .env.example (development defaults).');
}

const result = spawnSync('npm', ['run', '--silent', 'db:migrate'], { stdio: 'inherit', shell: true });
if (result.status !== 0) {
  console.error('✗ Database migration failed. See the message above.');
  process.exit(result.status ?? 1);
}

console.log('\nSetup complete. Next:');
console.log('  1. Invite yourself:  npm run invite -- you@example.com');
console.log('  2. Start Flico:      npm run dev');
console.log('  3. Open:             http://localhost:5173');
