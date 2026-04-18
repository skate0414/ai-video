#!/usr/bin/env node

import { chromium } from 'playwright';
import { getJson, getServerUrl, parseCliArgs } from '../lib/backendApi.mjs';
import { resolveChromiumChannel } from '../lib/paths.mjs';

const STEALTH_ARGS = [
	'--disable-blink-features=AutomationControlled',
	'--disable-infobars',
	'--no-first-run',
	'--no-default-browser-check',
];

async function safeCount(page, selector) {
	try { return await page.locator(selector).count(); } catch { return 0; }
}

async function extractLatestResponseText(page, selector) {
	try {
		const blocks = page.locator(selector);
		const count = await blocks.count();
		if (count === 0) return '';
		return String(await blocks.nth(count - 1).innerText().catch(() => '')).trim();
	} catch {
		return '';
	}
}

async function main() {
	const { positionals, flags } = parseCliArgs();
	const accountId = positionals[0];
	const serverUrl = getServerUrl(flags);
	if (!accountId) throw new Error('Usage: node src/testing/scripts/probe-account.mjs <accountId> [--server-url <url>]');

	const state = await getJson(serverUrl, '/api/state');
	const providers = await getJson(serverUrl, '/api/providers');
	const account = (state.accounts || []).find((item) => item.id === accountId);
	if (!account) throw new Error(`Account not found: ${accountId}`);
	const provider = (providers || []).find((item) => item.id === account.provider);
	if (!provider?.selectors) throw new Error(`Selectors not found for provider: ${account.provider}`);

	let context;
	try {
		const channel = await resolveChromiumChannel();
		context = await chromium.launchPersistentContext(account.profileDir, {
			...(channel ? { channel } : {}),
			headless: false,
			viewport: { width: 1400, height: 900 },
			args: STEALTH_ARGS,
			ignoreDefaultArgs: ['--enable-automation'],
		});

		const page = context.pages()[0] || await context.newPage();
		await page.goto(provider.selectors.chatUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });

		const fallbackSelectors = [provider.selectors.promptInput, 'textarea', '[contenteditable="true"]'].filter(Boolean);
		let input = null;
		for (const selector of fallbackSelectors) {
			if (await safeCount(page, selector) > 0) {
				input = page.locator(selector).first();
				break;
			}
		}
		if (!input) throw new Error('No prompt input found');

		await input.click({ timeout: 10000 });
		const isContentEditable = await input.evaluate((element) => element.getAttribute('contenteditable') === 'true').catch(() => false);
		if (isContentEditable) {
			await input.evaluate((element, prompt) => {
				element.textContent = prompt;
				element.dispatchEvent(new Event('input', { bubbles: true }));
			}, 'Health check: reply with OK only.');
		} else {
			await input.fill('Health check: reply with OK only.');
		}

		const beforeCount = await safeCount(page, provider.selectors.responseBlock);
		if (provider.selectors.sendButton && await safeCount(page, provider.selectors.sendButton) > 0) {
			await page.locator(provider.selectors.sendButton).first().click({ timeout: 10000 });
		} else {
			await input.press('Enter');
		}

		const deadline = Date.now() + 120000;
		while (Date.now() < deadline) {
			if (provider.selectors.quotaExhaustedIndicator && await safeCount(page, provider.selectors.quotaExhaustedIndicator) > 0) {
				throw new Error('Quota exhausted signal detected');
			}

			const count = await safeCount(page, provider.selectors.responseBlock);
			if (count > beforeCount) {
				const preview = await extractLatestResponseText(page, provider.selectors.responseBlock);
				console.log(JSON.stringify({ ok: true, accountId, provider: account.provider, answerPreview: preview.slice(0, 200) }, null, 2));
				return;
			}

			await new Promise((resolve) => setTimeout(resolve, 2000));
		}

		throw new Error('Timed out waiting for response');
	} finally {
		await context?.close().catch(() => {});
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack : String(error));
	process.exit(1);
});
