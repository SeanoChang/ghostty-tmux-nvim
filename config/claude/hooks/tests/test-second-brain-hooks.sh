#!/bin/bash
# Tests for the second-brain question-log + end-of-session sweep hooks.
# Run: bash ~/.claude/hooks/tests/test-second-brain-hooks.sh
HOOKS="$(cd "$(dirname "$0")/.." && pwd)"
LOG_HOOK="$HOOKS/second-brain-log-prompt.sh"
STOP_HOOK="$HOOKS/second-brain-capture-stop.sh"
pass=0; fail=0
ok(){ printf '  \033[32mPASS\033[0m %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[31mFAIL\033[0m %s\n     %s\n' "$1" "$2"; fail=$((fail+1)); }

setup(){ TD=$(mktemp -d); export SB_QUESTION_LOG_DIR="$TD/questions"; }
teardown(){ rm -rf "$TD"; }
mktranscript(){ printf '%s\n' "$1" > "$TD/transcript.jsonl"; echo "$TD/transcript.jsonl"; }

echo "== second-brain-log-prompt.sh =="

setup
out=$(echo '{"session_id":"s1","cwd":"/tmp","prompt":"what is a basic block"}' | bash "$LOG_HOOK" 2>/dev/null)
n=$(wc -l < "$SB_QUESTION_LOG_DIR/s1.jsonl" 2>/dev/null | tr -d " " || echo 0)
[ "$n" = "1" ] && ok "appends one line to <session_id>.jsonl" || no "appends one line to <session_id>.jsonl" "got $n lines"
grep -q "what is a basic block" "$SB_QUESTION_LOG_DIR/s1.jsonl" 2>/dev/null \
  && ok "logged line contains the prompt text" || no "logged line contains the prompt text" "prompt missing"
[ -z "$out" ] && ok "prints nothing on stdout (would pollute context)" || no "prints nothing on stdout" "got: $out"
teardown

setup
echo '{"session_id":"s2","prompt":"first"}'  | bash "$LOG_HOOK" >/dev/null 2>&1
echo '{"session_id":"s2","prompt":"second"}' | bash "$LOG_HOOK" >/dev/null 2>&1
n=$(wc -l < "$SB_QUESTION_LOG_DIR/s2.jsonl" 2>/dev/null | tr -d " " || echo 0)
[ "$n" = "2" ] && ok "appends rather than overwrites" || no "appends rather than overwrites" "got $n lines"
teardown

setup
mkdir -p "$SB_QUESTION_LOG_DIR"
touch -t 202501010000 "$SB_QUESTION_LOG_DIR/ancient.jsonl"
touch "$SB_QUESTION_LOG_DIR/fresh.jsonl"
echo '{"session_id":"s3","prompt":"x"}' | bash "$LOG_HOOK" >/dev/null 2>&1
[ ! -f "$SB_QUESTION_LOG_DIR/ancient.jsonl" ] && ok "prunes logs older than 30 days" || no "prunes logs older than 30 days" "ancient.jsonl survived"
[ -f "$SB_QUESTION_LOG_DIR/fresh.jsonl" ] && ok "keeps recent logs" || no "keeps recent logs" "fresh.jsonl was pruned"
teardown

setup
echo '{"session_id":"s4","prompt":"has \"quotes\" and \\ backslash"}' | bash "$LOG_HOOK" >/dev/null 2>&1
jq -e . "$SB_QUESTION_LOG_DIR/s4.jsonl" >/dev/null 2>&1 \
  && ok "emits valid JSON for prompts with quotes/backslashes" || no "emits valid JSON for prompts with quotes/backslashes" "jq rejected the line"
teardown

echo "== second-brain-capture-stop.sh =="

setup
mkdir -p "$SB_QUESTION_LOG_DIR"
echo '{"ts":"x","prompt":"look into this course gen ai policy"}' > "$SB_QUESTION_LOG_DIR/s5.jsonl"
tp=$(mktranscript '{"role":"user"}')
out=$(echo "{\"session_id\":\"s5\",\"transcript_path\":\"$tp\",\"stop_hook_active\":false}" | bash "$STOP_HOOK" 2>/dev/null)
echo "$out" | jq -e '.decision=="block"' >/dev/null 2>&1 \
  && ok "blocks when a question log exists and nothing was captured" || no "blocks when a question log exists and nothing was captured" "got: ${out:-<empty>}"
echo "$out" | jq -r '.reason' 2>/dev/null | grep -q "gen ai policy" \
  && ok "reason lists the logged prompts for the sweep" || no "reason lists the logged prompts for the sweep" "prompt not in reason"
teardown

setup
mkdir -p "$SB_QUESTION_LOG_DIR"
echo '{"ts":"x","prompt":"q"}' > "$SB_QUESTION_LOG_DIR/s6.jsonl"
tp=$(mktranscript '{"text":"ran sb gap \"unanswered thing\""}')
out=$(echo "{\"session_id\":\"s6\",\"transcript_path\":\"$tp\",\"stop_hook_active\":false}" | bash "$STOP_HOOK" 2>/dev/null)
[ -z "$out" ] && ok "silent when a capture decision already ran" || no "silent when a capture decision already ran" "got: $out"
teardown

setup
mkdir -p "$SB_QUESTION_LOG_DIR"
echo '{"ts":"x","prompt":"q"}' > "$SB_QUESTION_LOG_DIR/s7.jsonl"
tp=$(mktranscript '{"text":"SECOND_BRAIN_CAPTURE_CHECK already asked"}')
out=$(echo "{\"session_id\":\"s7\",\"transcript_path\":\"$tp\",\"stop_hook_active\":false}" | bash "$STOP_HOOK" 2>/dev/null)
[ -z "$out" ] && ok "fires at most once per session (marker suppresses)" || no "fires at most once per session" "got: $out"
teardown

setup
mkdir -p "$SB_QUESTION_LOG_DIR"
echo '{"ts":"x","prompt":"q"}' > "$SB_QUESTION_LOG_DIR/s8.jsonl"
tp=$(mktranscript '{"role":"user"}')
out=$(echo "{\"session_id\":\"s8\",\"transcript_path\":\"$tp\",\"stop_hook_active\":true}" | bash "$STOP_HOOK" 2>/dev/null)
[ -z "$out" ] && ok "silent when stop_hook_active (no hook loop)" || no "silent when stop_hook_active" "got: $out"
teardown

setup
tp=$(mktranscript '{"role":"user"}')
out=$(echo "{\"session_id\":\"nosuch\",\"transcript_path\":\"$tp\",\"stop_hook_active\":false}" | bash "$STOP_HOOK" 2>/dev/null)
[ -z "$out" ] && ok "silent when the session logged no questions" || no "silent when the session logged no questions" "got: $out"
teardown

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
