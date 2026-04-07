#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseCliArgs } from '../lib/backendApi.mjs';
import { PROJECTS_DIR } from '../lib/paths.mjs';

function main() {
	const { positionals } = parseCliArgs();
	const projectId = positionals[0];
	if (!projectId) {
		throw new Error('Usage: node src/testing/scripts/check-scenes.mjs <projectId>');
	}

	const scenesPath = join(PROJECTS_DIR, projectId, 'scenes.json');
	const scenesData = JSON.parse(readFileSync(scenesPath, 'utf-8'));
	const scenes = Array.isArray(scenesData) ? scenesData : Object.values(scenesData);

	console.log('=== Scene Inventory ===');
	console.log('Project:', projectId);
	console.log('Total scenes:', scenes.length);
	console.log('Image scenes:', scenes.filter((scene) => scene.assetType === 'image').length);
	console.log('Video scenes:', scenes.filter((scene) => scene.assetType === 'video').length);
	console.log('Undefined type:', scenes.filter((scene) => !scene.assetType).length);
	console.log('');

	scenes.forEach((scene, index) => {
		const assetFile = scene.assetUrl ? basename(scene.assetUrl) : 'EMPTY';
		const assetShort = assetFile.length > 20 ? `...${assetFile.slice(-17)}` : assetFile;
		console.log(`${String(index).padStart(2, '0')}: #${String(scene.number).padStart(2, '0')} ${(scene.assetType || 'undef').padEnd(6)} ${assetShort.padEnd(20)} kf=${scene.keyframeUrl ? 'yes' : 'no'} au=${scene.audioUrl ? 'yes' : 'no'} dur=${scene.estimatedDuration || '?'}`);
	});
}

try {
	main();
} catch (error) {
	console.error(error instanceof Error ? error.stack : String(error));
	process.exit(1);
}
