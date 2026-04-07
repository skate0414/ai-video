#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { getJson, getServerUrl, parseCliArgs } from '../lib/backendApi.mjs';
import { REPO_ROOT } from '../lib/paths.mjs';

function summarizeAccounts(accounts) {
	const grouped = new Map();
	for (const account of accounts || []) {
		const current = grouped.get(account.provider) || { total: 0, exhausted: 0, available: 0 };
		current.total += 1;
		if (account.quotaExhausted) current.exhausted += 1;
		else current.available += 1;
		grouped.set(account.provider, current);
	}
	return grouped;
}

function printCheck(name, ok, detail) {
	console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
	if (detail) console.log(`  ${detail}`);
}

async function main() {
	const { flags } = parseCliArgs();
	const serverUrl = getServerUrl(flags);
	const strong = Boolean(flags.get('--strong'));

	console.log('=== Preflight Health Check ===');
	console.log(`server: ${serverUrl}`);

	const health = await getJson(serverUrl, '/health');
	const state = await getJson(serverUrl, '/api/state');
	const config = await getJson(serverUrl, '/api/config');
	const videoProviderConfig = await getJson(serverUrl, '/api/config/video-provider').catch(() => null);

	printCheck('server health', health.status === 'ok', `uptime=${Math.round(Number(health.uptime || 0))}s`);
	printCheck('config loaded', true, `qualityTier=${config.qualityTier} hasApiKey=${Boolean(config.hasApiKey)}`);

	const grouped = summarizeAccounts(state.accounts || []);
	for (const [provider, summary] of grouped.entries()) {
		printCheck(`accounts:${provider}`, summary.available > 0, `total=${summary.total} exhausted=${summary.exhausted} available=${summary.available}`);
	}

	const profileDirs = videoProviderConfig?.profileDirs || (videoProviderConfig?.profileDir ? [videoProviderConfig.profileDir] : []);
	const existingProfiles = profileDirs.filter((dir) => existsSync(dir));
	printCheck('video provider profiles', existingProfiles.length > 0, `${existingProfiles.length}/${profileDirs.length} profile dirs exist`);

	if (strong) {
		const mustHaveProviders = ['chatgpt', 'gemini'];
		for (const provider of mustHaveProviders) {
			const summary = grouped.get(provider) || { available: 0, total: 0, exhausted: 0 };
			printCheck(`strong:${provider}`, summary.available > 0, `available=${summary.available}`);
		}
		printCheck('strong:repo-root', existsSync(REPO_ROOT), REPO_ROOT);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack : String(error));
	process.exit(1);
});
