import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StageReviewShell } from './StageReviewShell';

describe('StageReviewShell', () => {
  it('renders stage label and status text', () => {
    render(
      <StageReviewShell
        stageName="STYLE_EXTRACTION"
        stageLabel="风格提取"
        stageStatus="completed"
      >
        <div>content</div>
      </StageReviewShell>,
    );
    expect(screen.getByText('风格提取')).toBeInTheDocument();
    expect(screen.getByText('已完成')).toBeInTheDocument();
  });

  it('renders children in the output area', () => {
    render(
      <StageReviewShell
        stageName="SCRIPT_GENERATION"
        stageLabel="脚本生成"
        stageStatus="processing"
      >
        <p data-testid="child">Hello world</p>
      </StageReviewShell>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders issues area when issues prop is provided', () => {
    render(
      <StageReviewShell
        stageName="QA_REVIEW"
        stageLabel="QA 审查"
        stageStatus="completed"
        issues={<span>2 issues found</span>}
      >
        <div>content</div>
      </StageReviewShell>,
    );
    expect(screen.getByText('2 issues found')).toBeInTheDocument();
  });

  it('does not render issues area when issues prop is absent', () => {
    const { container } = render(
      <StageReviewShell
        stageName="QA_REVIEW"
        stageLabel="QA 审查"
        stageStatus="completed"
      >
        <div>content</div>
      </StageReviewShell>,
    );
    // No border-t issues section should exist
    expect(container.querySelector('.border-t')).toBeNull();
  });

  it('shows duration in seconds when < 60', () => {
    render(
      <StageReviewShell
        stageName="STYLE_EXTRACTION"
        stageLabel="风格提取"
        stageStatus="completed"
        duration={32}
      >
        <div>content</div>
      </StageReviewShell>,
    );
    expect(screen.getByText(/32秒/)).toBeInTheDocument();
  });

  it('shows duration in minutes and seconds when >= 60', () => {
    render(
      <StageReviewShell
        stageName="STYLE_EXTRACTION"
        stageLabel="风格提取"
        stageStatus="completed"
        duration={125}
      >
        <div>content</div>
      </StageReviewShell>,
    );
    expect(screen.getByText(/2分5秒/)).toBeInTheDocument();
  });

  it('does not show duration when absent', () => {
    const { container } = render(
      <StageReviewShell
        stageName="STYLE_EXTRACTION"
        stageLabel="风格提取"
        stageStatus="pending"
      >
        <div>content</div>
      </StageReviewShell>,
    );
    expect(container.textContent).not.toMatch(/秒/);
  });

  it('does not show duration when 0', () => {
    const { container } = render(
      <StageReviewShell
        stageName="STYLE_EXTRACTION"
        stageLabel="风格提取"
        stageStatus="pending"
        duration={0}
      >
        <div>content</div>
      </StageReviewShell>,
    );
    expect(container.textContent).not.toMatch(/秒/);
  });

  it.each([
    ['pending', '等待中'],
    ['processing', '处理中'],
    ['completed', '已完成'],
    ['error', '错误'],
  ] as const)('shows correct label for %s status', (status, label) => {
    render(
      <StageReviewShell
        stageName="TEST"
        stageLabel="测试"
        stageStatus={status}
      >
        <div>content</div>
      </StageReviewShell>,
    );
    expect(screen.getByText(label, { exact: true })).toBeInTheDocument();
  });

  it('renders status dot with correct color class for each status', () => {
    const { container, rerender } = render(
      <StageReviewShell stageName="T" stageLabel="T" stageStatus="completed">
        <div />
      </StageReviewShell>,
    );
    const dot = container.querySelector('.rounded-full')!;
    expect(dot.className).toContain('bg-emerald-500');

    rerender(
      <StageReviewShell stageName="T" stageLabel="T" stageStatus="error">
        <div />
      </StageReviewShell>,
    );
    expect(dot.className).toContain('bg-red-500');

    rerender(
      <StageReviewShell stageName="T" stageLabel="T" stageStatus="processing">
        <div />
      </StageReviewShell>,
    );
    expect(dot.className).toContain('bg-white');
    expect(dot.className).toContain('animate-pulse');
  });
});
