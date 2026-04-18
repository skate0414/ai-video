#!/usr/bin/env python3
"""Extract actual prompts from AI logs for documentation."""
import json, os, glob

PROJ = os.path.expanduser(
    "~/Library/Application Support/ai-video-browser-shell/data/projects/proj_1775959231425/ai-logs"
)

prefixes = {
    "STYLE_EXTRACTION_self_assess": "0096",
    "STYLE_EXTRACTION_extract": "0097",
    "RESEARCH_facts": "0098",
    "RESEARCH_verify": "0099",
    "NARRATIVE_MAP_calib": "0105",
    "SCRIPT_GEN_final": "0109",
    "QA_REVIEW": "0110",
    "STORYBOARD": "0118",
    "REFERENCE_IMAGE": "0120",
    "KEYFRAME_GEN": "0128",
    "VIDEO_GEN": "0231",
}

results = {}
for label, prefix in prefixes.items():
    matches = sorted(glob.glob(os.path.join(PROJ, prefix + "_*.json")))
    if not matches:
        results[label] = None
        continue
    f = matches[0]
    with open(f) as fp:
        d = json.load(fp)
    inp = d.get("input", {})
    prompt = inp.get("prompt", "")
    prompt_text = ""
    if isinstance(prompt, str):
        prompt_text = prompt
    elif isinstance(prompt, list):
        parts = []
        for m in prompt:
            role = m.get("role", "?")
            c = m.get("content", "")
            if isinstance(c, list):
                texts = [p.get("text", "") for p in c if p.get("type") == "text"]
                c = "\n".join(texts)
            parts.append({"role": role, "content": c})
        prompt_text = json.dumps(parts, ensure_ascii=False, indent=2)
    
    out = d.get("output", {})
    resp_text = out.get("text", "")
    
    results[label] = {
        "file": os.path.basename(f),
        "stage": d.get("stage"),
        "taskType": d.get("taskType"),
        "method": d.get("method"),
        "provider": d.get("provider"),
        "durationMs": d.get("durationMs"),
        "prompt": prompt_text,
        "response_preview": resp_text[:1000] if isinstance(resp_text, str) else str(resp_text)[:1000],
    }

out_path = os.path.join(os.path.dirname(PROJ), "prompt-details.json")
with open(out_path, "w") as fp:
    json.dump(results, fp, ensure_ascii=False, indent=2)
print("Written to:", out_path)
print("Entries:", len([v for v in results.values() if v]))
