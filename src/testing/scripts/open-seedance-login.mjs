#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { REPO_ROOT } from '../lib/paths.mjs';

const args = ['src/testing/scripts/auth-browser.mjs', '--provider', 'seedance', ...process.argv.slice(2)];
const child = spawn(process.execPath, args, { cwd: REPO_ROOT, env: process.env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
