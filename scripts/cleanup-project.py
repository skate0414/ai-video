#!/usr/bin/env python3
"""Reset a project from SCRIPT_GENERATION onward for regeneration."""
import json, os, glob, shutil, sys

proj_dir = sys.argv[1] if len(sys.argv) > 1 else "."
os.chdir(proj_dir)

# 1. Reset stageStatus from SCRIPT_GENERATION onward
with open('project.json') as f:
    p = json.load(f)

stages_to_reset = [
    'SCRIPT_GENERATION', 'QA_REVIEW', 'TEMPORAL_PLANNING',
    'STORYBOARD', 'VIDEO_IR_COMPILE', 'REFERENCE_IMAGE',
    'KEYFRAME_GEN', 'VIDEO_GEN', 'TTS', 'ASSEMBLY', 'REFINEMENT'
]

for stage in stages_to_reset:
    if stage in p.get('stageStatus', {}):
        p['stageStatus'][stage] = 'pending'

p['scriptOutput'] = None
p['qaReviewResult'] = None
p['temporalPlan'] = None
p['scenes'] = []
p['videoIR'] = None
p['finalVideoPath'] = None
p['refinementHistory'] = []
p['currentStage'] = 'SCRIPT_GENERATION'
p['isPaused'] = False

with open('project.json', 'w') as f:
    json.dump(p, f, ensure_ascii=False, indent=2)
print("project.json updated")

# 2. Delete downstream artifact files
files_to_delete = [
    'script.json', 'script.cir.json', 'script-validation.json',
    'qa-review.json', 'contamination-check.json',
    'temporal-plan.cir.json', 'storyboard.cir.json', 'storyboard-validation.json',
    'video-ir.cir.json', 'scenes.json',
    'assembly-validation.json', 'final-risk-gate.json',
    'refinement.json', 'POST_ASSEMBLY_QA',
    'match-report.md'
]

for fname in files_to_delete:
    path = os.path.join(proj_dir, fname)
    if os.path.exists(path):
        os.remove(path)
        print(f"Deleted: {fname}")

# 3. Delete TTS audio files and assembly output
assets_dir = os.path.join(proj_dir, 'assets')
if os.path.isdir(assets_dir):
    for f in glob.glob(os.path.join(assets_dir, 'tts_*.mp3')):
        os.remove(f)
        print(f"Deleted: assets/{os.path.basename(f)}")

    for f in glob.glob(os.path.join(assets_dir, '*.mp4')):
        os.remove(f)
        print(f"Deleted: assets/{os.path.basename(f)}")

    srt = os.path.join(assets_dir, 'subtitles.srt')
    if os.path.exists(srt):
        os.remove(srt)
        print("Deleted: assets/subtitles.srt")

    tmp_dir = os.path.join(assets_dir, '_assembly_tmp')
    if os.path.isdir(tmp_dir):
        shutil.rmtree(tmp_dir)
        print("Deleted: assets/_assembly_tmp/")

print("\nCleanup complete!")
