#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getJson, getServerUrl, parseCliArgs, postJson } from '../lib/backendApi.mjs';
import { PROJECTS_DIR, REPO_ROOT } from '../lib/paths.mjs';

async function main() {
	const { positionals, flags } = parseCliArgs();
	const projectId = positionals[0];
	const serverUrl = getServerUrl(flags);
	if (!projectId) throw new Error('Usage: node src/testing/scripts/retry-video-gen.mjs <projectId> [--server-url <url>]');

	const project = await getJson(serverUrl, `/api/pipeline/${projectId}`);
	const scenesPath = join(PROJECTS_DIR, projectId, 'scenes.json');
	const projectPath = join(PROJECTS_DIR, projectId, 'project.json');
	if (!existsSync(scenesPath) || !existsSync(projectPath)) {
		throw new Error(`Project files not found for ${projectId}`);
	}

	const diskScenes = JSON.parse(readFileSync(scenesPath, 'utf-8'));
	let restored = 0;
	for (const scene of diskScenes) {
		if (scene.assetType === 'image' && scene.keyframeUrl) {
			scene.assetType = 'video';
			delete scene.assetUrl;
			scene.status = 'pending';
			restored += 1;
		}
	}

	writeFileSync(scenesPath, JSON.stringify(diskScenes, null, 2));

	const diskProject = JSON.parse(readFileSync(projectPath, 'utf-8'));
	diskProject.scenes = diskScenes;
	diskProject.stageStatus.VIDEO_GEN = 'pending';
	diskProject.stageStatus.TTS = 'pending';
	diskProject.stageStatus.ASSEMBLY = 'pending';
	diskProject.stageStatus.REFINEMENT = 'pending';
	delete diskProject.error;
	writeFileSync(projectPath, JSON.stringify(diskProject, null, 2));

	console.log(`restored ${restored} scenes for project ${projectId}`);
	console.log(`repo root: ${REPO_ROOT}`);
	console.log(`current stage: ${project.currentStage || '(awaiting)'}`);

	await postJson(serverUrl, `/api/pipeline/${projectId}/retry/VIDEO_GEN`, {});
	console.log('VIDEO_GEN retry triggered');
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack : String(error));
	process.exit(1);
});
