#!/usr/bin/env node

import { getJson, getServerUrl, parseCliArgs } from '../lib/backendApi.mjs';

async function main() {
	const { positionals, flags } = parseCliArgs();
	const projectId = positionals[0];
	const serverUrl = getServerUrl(flags);
	if (!projectId) throw new Error('Usage: node src/testing/scripts/check-progress.mjs <projectId> [--server-url <url>]');

	const project = await getJson(serverUrl, `/api/pipeline/${projectId}`);
	console.log('stage:', project.currentStage);
	const videoScenes = (project.scenes || []).filter((scene) => scene.keyframeUrl);
	const done = videoScenes.filter((scene) => scene.assetUrl && scene.assetType === 'video');
	const degraded = videoScenes.filter((scene) => scene.assetUrl && scene.assetType === 'image');
	const pending = videoScenes.filter((scene) => !scene.assetUrl);

	console.log(`videos: ${done.length}  degraded: ${degraded.length}  pending: ${pending.length}`);
	done.forEach((scene) => console.log(`  ✅ scene ${scene.number}: ${(scene.assetUrl || '').split('/').pop()}`));
	degraded.forEach((scene) => console.log(`  ⚠️ scene ${scene.number}: degraded to image`));
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack : String(error));
	process.exit(1);
});
