#!/bin/bash
# Stop hook: one-shot end-of-session sweep over the questions this session asked.
# Fires when second-brain-log-prompt.sh recorded prompts for this session and the
# transcript shows no capture decision (sb propose/capture/promote/gap). At most
# once per session — the SECOND_BRAIN_CAPTURE_CHECK marker in the emitted reason
# suppresses repeats.
input=$(cat)
active=$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null)
[ "$active" = "true" ] && exit 0

sid=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null)
tp=$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null)
dir="${SB_QUESTION_LOG_DIR:-$HOME/.claude/second-brain/questions}"
log="$dir/$sid.jsonl"
{ [ -n "$sid" ] && [ -f "$log" ]; } || exit 0

if [ -n "$tp" ] && [ -f "$tp" ]; then
  grep -qE 'sb (propose|capture|promote|gap)|SECOND_BRAIN_CAPTURE_CHECK' "$tp" && exit 0
fi

prompts=$(jq -r '.prompt // empty' "$log" 2>/dev/null \
  | grep -v '^[[:space:]]*$' | cut -c1-200 | head -40 | awk '{printf "  %d. %s\n", NR, $0}')
[ -n "$prompts" ] || exit 0

reason="SECOND_BRAIN_CAPTURE_CHECK: end-of-session sweep. This session asked:

$prompts
Pick only the ones plausibly worth vault attention (a concept, a course fact, a
design decision) and ignore pure session mechanics. For those: run
\`sb find\` on each, then apply the second-brain-obsidian capture gates —
\`sb propose\` (promote via obsidian-writing) if the session produced
generalizable knowledge, \`sb gap\` if a question stayed unanswered.
If nothing here is worth capturing, say so in one line and finish."

jq -cn --arg r "$reason" '{decision:"block", reason:$r}'
exit 0
