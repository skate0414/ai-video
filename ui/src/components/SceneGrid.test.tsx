import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SceneGrid } from './SceneGrid';
import type { PipelineScene } from '../types';

const makeScene = (id: string, overrides?: Partial<PipelineScene>): PipelineScene => ({
  id,
  number: 1,
  narrative: `Narrative for ${id}`,
  visualPrompt: 'A visual prompt',
  estimatedDuration: 5,
  status: 'done',
  assetType: 'image',
  ...overrides,
});

const noop = () => {};

describe('SceneGrid viewMode', () => {
  const scenes = [makeScene('s1'), makeScene('s2')];

  it('defaults to grid view', () => {
    const { container } = render(
      <SceneGrid scenes={scenes} onRegenerate={noop} />,
    );
    // Grid view uses a CSS grid; timeline uses space-y-2 vertical list
    // Grid button should be active (bg-zinc-700)
    const gridBtn = screen.getByTitle('网格视图');
    expect(gridBtn.className).toContain('bg-zinc-700');
  });

  it('toggles to timeline view on click', () => {
    render(<SceneGrid scenes={scenes} onRegenerate={noop} />);
    const timelineBtn = screen.getByTitle('列表视图');
    fireEvent.click(timelineBtn);
    expect(timelineBtn.className).toContain('bg-zinc-700');
  });

  it('uses controlled viewMode when provided', () => {
    render(
      <SceneGrid scenes={scenes} onRegenerate={noop} viewMode="timeline" />,
    );
    const timelineBtn = screen.getByTitle('列表视图');
    expect(timelineBtn.className).toContain('bg-zinc-700');
  });

  it('disables toggle buttons when controlled', () => {
    render(
      <SceneGrid scenes={scenes} onRegenerate={noop} viewMode="timeline" />,
    );
    const gridBtn = screen.getByTitle('网格视图');
    const timelineBtn = screen.getByTitle('列表视图');
    expect(gridBtn).toBeDisabled();
    expect(timelineBtn).toBeDisabled();
  });

  it('calls onViewModeChange when provided', () => {
    const onChange = vi.fn();
    render(
      <SceneGrid scenes={scenes} onRegenerate={noop} onViewModeChange={onChange} />,
    );
    const timelineBtn = screen.getByTitle('列表视图');
    fireEvent.click(timelineBtn);
    expect(onChange).toHaveBeenCalledWith('timeline');
  });
});
