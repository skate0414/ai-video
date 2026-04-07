#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../lib/paths.mjs';

const filePath = join(DATA_DIR, 'config.json');
console.log('filePath:', filePath);
console.log('exists:', existsSync(filePath));
if (!existsSync(filePath)) process.exit(1);

const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
console.log('keys:', Object.keys(parsed));
console.log('geminiApiKey:', Boolean(parsed.geminiApiKey));
console.log('videoProviderConfig:', Boolean(parsed.videoProviderConfig));
console.log('profileDirs:', parsed.videoProviderConfig?.profileDirs?.length || 0);
