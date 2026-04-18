#!/usr/bin/env node

import { getServerUrl, parseCliArgs, postJson } from '../lib/backendApi.mjs';

async function main() {
	const { positionals, flags } = parseCliArgs();
	const serverUrl = getServerUrl(flags);
	const topic = positionals[0] || String(flags.get('--topic') || 'AI的未来');
	const title = String(flags.get('--title') || '完整流水线验证');
	const qualityTier = String(flags.get('--quality-tier') || 'free');

	const project = await postJson(serverUrl, '/api/pipeline', { topic, title, qualityTier });
	console.log('✅ Project created successfully');
	console.log(`ID: ${project.id}`);
	console.log(`Topic: ${project.topic}`);
	console.log(`Title: ${project.title}`);
	console.log(`Quality: ${project.qualityTier}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack : String(error));
	process.exit(1);
});
