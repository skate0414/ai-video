#!/usr/bin/env python3
"""Extract prompts from AI log files for documentation."""
import json, os, sys, glob

PROJ = os.path.expanduser(
    "~/Library/Application Support/ai-video-browser-shell/data/projects/proj_1775959231425"
)
LOG_DIR = os.path.join(PROJ, "ai-logs")

# Representative log files - first occurrence of each stage/task combo
samples = {}
for f in sorted(glob.glob(os.path.join(LOG_DIR, "*.json"))):
    basename = os.path.basename(f)
    try:
        with open(f) as fp:
            d = json.load(fp)
    except:
        continue
    stage = d.get("stage", "UNKNOWN")
    task = d.get("task", "unknown")
    key = f"{stage}_{task}"
    if key not in samples:
        samples[key] = {"file": basename, "data": d}

# Output structured info
output = []
for key in sorted(samples.keys()):
    info = samples[key]
    d = info["data"]
    entry = {
        "file": info["file"],
        "stage": d.get("stage"),
        "task": d.get("task"),
        "type": d.get("type"),
        "provider": d.get("provider"),
        "model": d.get("model"),
        "durationMs": d.get("durationMs"),
        "success": d.get("success"),
    }
    
    # Extract prompt
    prompt = d.get("prompt", "")
    if isinstance(prompt, list):
        messages = []
        for m in prompt:
            role = m.get("role", "?")
            content = m.get("content", "")
            if isinstance(content, list):
                # multimodal content
                text_parts = [p.get("text", "") for p in content if p.get("type") == "text"]
                content = "\n".join(text_parts)
            messages.append({"role": role, "content": content})
        entry["prompt_messages"] = messages
    elif isinstance(prompt, str):
        entry["prompt_text"] = prompt
    
    # Extract response summary
    resp = d.get("response", "")
    if isinstance(resp, str):
        entry["response_preview"] = resp[:500]
    elif isinstance(resp, dict):
        entry["response_keys"] = list(resp.keys())
    
    output.append(entry)

# Write to file
out_path = os.path.join(PROJ, "prompt-extraction.json")
with open(out_path, "w") as fp:
    json.dump(output, fp, ensure_ascii=False, indent=2)

print(f"Extracted {len(output)} unique stage/task combinations from {len(os.listdir(LOG_DIR))} log files")
print(f"Output: {out_path}")

# Also print summary
for e in output:
    stage = e.get("stage", "?")
    task = e.get("task", "?")
    typ = e.get("type", "?")
    provider = e.get("provider", "?")
    dur = e.get("durationMs", "?")
    print(f"\n--- {stage} / {task} ({typ}) via {provider} [{dur}ms] ---")
    if "prompt_messages" in e:
        for m in e["prompt_messages"]:
            role = m["role"]
            content = m["content"][:600] if m["content"] else "(empty)"
            print(f"  [{role}]: {content}")
    elif "prompt_text" in e:
        print(f"  Prompt: {e['prompt_text'][:600]}")
    if "response_preview" in e:
        print(f"  Response: {e['response_preview'][:300]}")
