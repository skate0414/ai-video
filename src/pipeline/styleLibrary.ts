/* ------------------------------------------------------------------ */
/*  StyleLibrary – reusable source analysis templates across projects */
/*  Stores validated StyleProfile snapshots for compilation reuse.    */
/* ------------------------------------------------------------------ */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { FormatSignature } from '../cir/types.js';

export interface StyleTemplate {
  id: string;
  name: string;
  topic: string;
  createdAt: string;
  styleProfile: Record<string, unknown>;
  formatSignature?: FormatSignature;
}

export class StyleLibrary {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'style-templates');
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  list(): Omit<StyleTemplate, 'styleProfile'>[] {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const tpl = JSON.parse(readFileSync(join(this.dir, f), 'utf-8')) as StyleTemplate;
          return { id: tpl.id, name: tpl.name, topic: tpl.topic, createdAt: tpl.createdAt };
        } catch { return null; }
      })
      .filter(Boolean) as Omit<StyleTemplate, 'styleProfile'>[];
  }

  load(id: string): StyleTemplate | null {
    const filePath = join(this.dir, `${id}.json`);
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch { return null; }
  }

  save(name: string, topic: string, styleProfile: Record<string, unknown>, formatSignature?: FormatSignature): StyleTemplate {
    const id = `style_${Date.now()}`;
    const template: StyleTemplate = { id, name, topic, createdAt: new Date().toISOString(), styleProfile, formatSignature };
    writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(template, null, 2));
    return template;
  }

  delete(id: string): boolean {
    const filePath = join(this.dir, `${id}.json`);
    if (!existsSync(filePath)) return false;
    unlinkSync(filePath);
    return true;
  }
}
