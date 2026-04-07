#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { DATA_DIR, REPO_ROOT } from '../lib/paths.mjs';

const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
	cwd: REPO_ROOT,
	env: { ...process.env, DATA_DIR },
	stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 1));
