#!/bin/bash
# Stop hook: one-shot reminder to record a second-brain capture decision.
# Fires only when this session ran second-brain-obsidian recall but the
# transcript shows no capture decision (sb propose/capture/promote/gap),
# and at most once per session (the SECOND_BRAIN_CAPTURE_CHECK marker in
# the emitted reason suppresses repeats).
input=$(cat)
active=$(printf '%s' "$input" | jq -r '.stop_hook_active // false')
tp=$(printf '%s' "$input" | jq -r '.transcript_path // empty')
[ "$active" = "true" ] && exit 0
{ [ -n "$tp" ] && [ -f "$tp" ]; } || exit 0
grep -qE '"skill": ?"second-brain-obsidian"|<command-name>/?second-brain-obsidian' "$tp" || exit 0
grep -qE 'sb (propose|capture|promote|gap)|SECOND_BRAIN_CAPTURE_CHECK' "$tp" && exit 0
cat <<'EOF'
{"decision":"block","reason":"SECOND_BRAIN_CAPTURE_CHECK: this session ran second-brain recall but no capture decision is recorded. Apply the capture gates from second-brain-obsidian now: if the session produced generalizable knowledge, run sb propose (and promote via obsidian-writing); if a question stayed unanswered, record it with sb gap. If genuinely nothing is worth capturing, state that in one line and finish."}
EOF
exit 0
