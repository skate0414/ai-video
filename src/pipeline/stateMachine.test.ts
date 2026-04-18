import { describe, it, expect } from 'vitest';
import { assertStageTransition, transitionStage, InvalidStageTransitionError } from './stateMachine.js';
import type { ProcessStatus, PipelineStage } from '../../shared/types.js';

describe('Pipeline Stage State Machine', () => {
  describe('assertStageTransition', () => {
    it('allows pending → processing', () => {
      expect(() => assertStageTransition('CAPABILITY_ASSESSMENT', 'pending', 'processing')).not.toThrow();
    });

    it('allows processing → completed', () => {
      expect(() => assertStageTransition('SCRIPT_GENERATION', 'processing', 'completed')).not.toThrow();
    });

    it('allows processing → error', () => {
      expect(() => assertStageTransition('VIDEO_GEN', 'processing', 'error')).not.toThrow();
    });

    it('allows error → pending (retry)', () => {
      expect(() => assertStageTransition('QA_REVIEW', 'error', 'pending')).not.toThrow();
    });

    it('allows completed → pending (reset for retry)', () => {
      expect(() => assertStageTransition('TTS', 'completed', 'pending')).not.toThrow();
    });

    it('rejects pending → completed (skip processing)', () => {
      expect(() => assertStageTransition('ASSEMBLY', 'pending', 'completed'))
        .toThrow(InvalidStageTransitionError);
    });

    it('rejects completed → error', () => {
      expect(() => assertStageTransition('RESEARCH', 'completed', 'error'))
        .toThrow(InvalidStageTransitionError);
    });

    it('rejects pending → error', () => {
      expect(() => assertStageTransition('STORYBOARD', 'pending', 'error'))
        .toThrow(InvalidStageTransitionError);
    });

    it('rejects error → completed (must go through processing)', () => {
      expect(() => assertStageTransition('KEYFRAME_GEN', 'error', 'completed'))
        .toThrow(InvalidStageTransitionError);
    });
  });

  describe('transitionStage', () => {
    it('transitions and updates the status record', () => {
      const status: Record<string, ProcessStatus> = { CAPABILITY_ASSESSMENT: 'pending' };
      transitionStage(status, 'CAPABILITY_ASSESSMENT', 'processing');
      expect(status.CAPABILITY_ASSESSMENT).toBe('processing');
    });

    it('defaults missing stage to pending', () => {
      const status: Record<string, ProcessStatus> = {};
      transitionStage(status, 'RESEARCH' as PipelineStage, 'processing');
      expect(status.RESEARCH).toBe('processing');
    });

    it('throws on invalid transition', () => {
      const status: Record<string, ProcessStatus> = { TTS: 'pending' };
      expect(() => transitionStage(status, 'TTS', 'error')).toThrow(InvalidStageTransitionError);
    });

    it('full lifecycle: pending → processing → completed → pending (retry)', () => {
      const status: Record<string, ProcessStatus> = { ASSEMBLY: 'pending' };
      transitionStage(status, 'ASSEMBLY', 'processing');
      transitionStage(status, 'ASSEMBLY', 'completed');
      transitionStage(status, 'ASSEMBLY', 'pending');
      expect(status.ASSEMBLY).toBe('pending');
    });

    it('error recovery: pending → processing → error → pending', () => {
      const status: Record<string, ProcessStatus> = { VIDEO_GEN: 'pending' };
      transitionStage(status, 'VIDEO_GEN', 'processing');
      transitionStage(status, 'VIDEO_GEN', 'error');
      transitionStage(status, 'VIDEO_GEN', 'pending');
      expect(status.VIDEO_GEN).toBe('pending');
    });
  });
});
