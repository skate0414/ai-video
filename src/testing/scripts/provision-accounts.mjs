#!/usr/bin/env node

import { getJson, getServerUrl, parseCliArgs, postJson } from '../lib/backendApi.mjs';
import { REPO_ROOT } from '../lib/paths.mjs';

function summary(accounts, provider) {
	const list = accounts.filter((account) => account.provider === provider);
	const exhausted = list.filter((account) => account.quotaExhausted).length;
	return { total: list.length, exhausted, available: list.length - exhausted };
}

async function ensureCustomSeedanceProvider(serverUrl) {
	const providers = await getJson(serverUrl, '/api/providers');
	if (providers.some((provider) => provider.id === 'seedance')) return;

	await postJson(serverUrl, '/api/providers', {
		id: 'seedance',
		label: '即梦 (Jimeng)',
		selectors: {
			chatUrl: 'https://jimeng.jianying.com/ai-tool/generate?workspace=0&type=video',
			promptInput: 'textarea, [contenteditable="true"]',
			responseBlock: '[class*="message"], [class*="response"], .markdown, article',
			readyIndicator: 'textarea, [contenteditable="true"]',
			sendButton: 'button:has-text("生成"), button[type="submit"]',
			fileUploadTrigger: 'input[type="file"], [class*="upload"]',
			quotaExhaustedIndicator: 'text=quota',
		},
	});
}

async function addAccount(serverUrl, provider, label, profileDir) {
	const account = await postJson(serverUrl, '/api/accounts', { provider, label, profileDir });
	console.log(`added account: ${account.provider} / ${account.label}`);
}

async function main() {
	const { flags } = parseCliArgs();
	const serverUrl = getServerUrl(flags);

	await ensureCustomSeedanceProvider(serverUrl);
	let state = await getJson(serverUrl, '/api/state');

	let current = state.accounts.filter((account) => account.provider === 'chatgpt').length;
	for (let index = current + 1; index <= 5; index += 1) {
		await addAccount(serverUrl, 'chatgpt', `ChatGPT ${index}`, `${REPO_ROOT}/data/profiles/chatgpt-${index}`);
	}

	state = await getJson(serverUrl, '/api/state');
	current = state.accounts.filter((account) => account.provider === 'gemini').length;
	for (let index = current + 1; index <= 2; index += 1) {
		await addAccount(serverUrl, 'gemini', `Gemini ${index}`, `${REPO_ROOT}/data/profiles/gemini-${index}`);
	}

	state = await getJson(serverUrl, '/api/state');
	current = state.accounts.filter((account) => account.provider === 'seedance').length;
	if (current < 1) {
		await addAccount(serverUrl, 'seedance', 'Seedance 1', `${REPO_ROOT}/data/profiles/seedance-1`);
	}

	state = await getJson(serverUrl, '/api/state');
	for (const provider of ['chatgpt', 'gemini', 'seedance']) {
		const result = summary(state.accounts, provider);
		console.log(`${provider} total=${result.total} exhausted=${result.exhausted} available=${result.available}`);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack : String(error));
	process.exit(1);
});
