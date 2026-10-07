#!/bin/bash
# UserPromptSubmit hook: append every prompt to a per-session question log.
# Mechanical and silent by design — the judgment about what is vault-worthy
# happens once, at the end-of-session sweep in second-brain-capture-stop.sh.
# Never blocks and never writes to stdout (stdout would be injected as context).
input=$(cat)
sid=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
prompt=$(printf '%s' "$input" | jq -r '.prompt // empty' 2>/dev/null)
[ -n "$sid" ] || exit 0
[ -n "$prompt" ] || exit 0

dir="${SB_QUESTION_LOG_DIR:-$HOME/.claude/second-brain/questions}"
mkdir -p "$dir" 2>/dev/null || exit 0

cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
jq -cn --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg cwd "$cwd" --arg prompt "$prompt" \
  '{ts:$ts, cwd:$cwd, prompt:$prompt}' >> "$dir/$sid.jsonl" 2>/dev/null

# Retention: drop logs untouched for 30 days.
find "$dir" -name '*.jsonl' -type f -mtime +30 -delete 2>/dev/null
exit 0
