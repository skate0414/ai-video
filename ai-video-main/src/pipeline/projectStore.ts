/* ------------------------------------------------------------------ */
/*  ProjectStore – centralised project CRUD with atomic writes        */
/* ------------------------------------------------------------------ */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { PipelineProject, PipelineStage, ProcessStatus, LogEntry, ModelOverrides } from './types.js';
import { getStageOrder } from './stageRegistry.js';
// Ensure stage definitions are registered before getStageOrder() is called.
import './stages/defs/index.js';

function defaultStageStatus(): Record<PipelineStage, ProcessStatus> {
  return Object.fromEntries(getStageOrder().map(s => [s, 'pending' as ProcessStatus])) as Record<PipelineStage, ProcessStatus>;
}

/**
 * Atomically write a file by writing to a temp file first, then renaming.
 * Prevents partial/corrupt writes on crash.
 */
function atomicWriteFileSync(filePath: string, data: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(tmpPath, data);
  renameSync(tmpPath, filePath);
}

/**
 * ProjectStore manages all project persistence.
 * Single responsibility: read / write / delete project data and artifacts.
 */
export class ProjectStore {
  constructor(private readonly dataDir: string) {}

  getProjectDir(projectId: string): string {
    return join(this.dataDir, 'projects', projectId);
  }

  getAssetsDir(projectId: string): string {
    const dir = join(this.getProjectDir(projectId), 'assets');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  /* ---- Project CRUD ---- */

  create(topic: string, qualityTier: string, title?: string, modelOverrides?: ModelOverrides): PipelineProject {
    const id = `proj_${Date.now()}`;
    const project: PipelineProject = {
      id,
      title: title ?? topic.slice(0, 50),
      topic,
      qualityTier: qualityTier as any,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stageStatus: defaultStageStatus(),
      pauseAfterStages: ['QA_REVIEW', 'STORYBOARD', 'REFERENCE_IMAGE'],
      modelOverrides,
      logs: [],
    };
    this.save(project);
    return project;
  }

  save(project: PipelineProject): void {
    const dir = this.getProjectDir(project.id);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    atomicWriteFileSync(join(dir, 'project.json'), JSON.stringify(project, null, 2));
  }

  load(projectId: string): PipelineProject | null {
    const filePath = join(this.getProjectDir(projectId), 'project.json');
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  }

  delete(projectId: string): boolean {
    const dir = this.getProjectDir(projectId);
    if (!existsSync(dir)) return false;
    rmSync(dir, { recursive: true, force: true });
    return true;
  }

  list(): PipelineProject[] {
    const projectsDir = join(this.dataDir, 'projects');
    if (!existsSync(projectsDir)) return [];
    return readdirSync(projectsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => this.load(e.name))
      .filter((p): p is PipelineProject => p !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /* ---- Artifact persistence ---- */

  saveArtifact(projectId: string, filename: string, data: unknown): void {
    const dir = this.getProjectDir(projectId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    atomicWriteFileSync(join(dir, filename), JSON.stringify(data, null, 2));
  }

  loadArtifact<T>(projectId: string, filename: string): T | undefined {
    const filePath = join(this.getProjectDir(projectId), filename);
    if (!existsSync(filePath)) return undefined;
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch {
      return undefined;
    }
  }
}
