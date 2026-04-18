#!/usr/bin/env node

import { setTimeout as sleep } from 'node:timers/promises';
import { formatElapsed, getJson, getServerUrl, parseCliArgs, postJson } from '../lib/backendApi.mjs';

async function main() {
	const { positionals, flags } = parseCliArgs();
	const projectId = positionals[0];
	const serverUrl = getServerUrl(flags);
	const videoFilePath = flags.get('--video-file');

	if (!projectId) {
		throw new Error('Usage: node src/testing/scripts/auto-run-project.mjs <projectId> [--server-url <url>] [--video-file /abs/path/video.mp4]');
	}

	console.log(`Starting auto-run for ${projectId}`);
	await postJson(serverUrl, `/api/pipeline/${projectId}/start`, videoFilePath ? { videoFilePath } : undefined);

	let lastState = '';
	let lastHandledPause = '';
	const startTime = Date.now();

	while (true) {
		const project = await getJson(serverUrl, `/api/pipeline/${projectId}`);
		const currentState = `${project.currentStage || '(awaiting)'}:${project.currentStatus || 'pending'}:paused=${Boolean(project.isPaused)}`;

		if (currentState !== lastState) {
			lastState = currentState;
			console.log(`[${formatElapsed(startTime)}] ${currentState}`);
			if (project.error) console.log(`error=${project.error}`);
		}

		const failedStages = Object.entries(project.stageStatus || {})
			.filter(([, status]) => status === 'failed')
			.map(([stage]) => stage);
		if (failedStages.length > 0) {
			console.log(`FAILED ${failedStages.join(',')}`);
			if (project.error) console.log(project.error);
			process.exit(2);
		}

		if (project.stageStatus?.REFINEMENT === 'completed') {
			console.log('COMPLETE');
			if (project.finalVideoPath) console.log(project.finalVideoPath);
			return;
		}

		if (project.isPaused && project.pausedAtStage) {
			const pauseKey = `${project.pausedAtStage}:${project.updatedAt}`;
			if (pauseKey !== lastHandledPause) {
				lastHandledPause = pauseKey;
				console.log(`AUTO-HANDLE ${project.pausedAtStage}`);
				if (project.pausedAtStage === 'QA_REVIEW') {
					await postJson(serverUrl, `/api/pipeline/${projectId}/qa-override`, { feedback: 'auto-approved by src/testing/scripts/auto-run-project.mjs' });
				}
				if (project.pausedAtStage === 'REFERENCE_IMAGE') {
					await postJson(serverUrl, `/api/pipeline/${projectId}/approve-reference`, {});
				}
				await postJson(serverUrl, `/api/pipeline/${projectId}/resume`, {});
			}
		}

		await sleep(5000);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack : String(error));
	process.exit(1);
});
