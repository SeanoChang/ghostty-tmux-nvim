#!/bin/bash
# Tests for the second-brain question log hook and the on-demand sweep.
# Run: bash ~/.claude/hooks/tests/test-second-brain-hooks.sh
HOOKS="$(cd "$(dirname "$0")/.." && pwd)"
LOG_HOOK="$HOOKS/second-brain-log-prompt.sh"
SWEEP="$HOOKS/second-brain-sweep.sh"
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

echo "== second-brain-sweep.sh =="

now(){ date -u +%Y-%m-%dT%H:%M:%SZ; }
line(){ jq -cn --arg ts "$1" --arg cwd "$2" --arg prompt "$3" '{ts:$ts, cwd:$cwd, prompt:$prompt}'; }

setup
mkdir -p "$SB_QUESTION_LOG_DIR"
{
  line "$(now)" "/Users/x/vaults/Seano/Learning" "explain why the row space and the null space are perpendicular"
  line "$(now)" "/Users/x/dev/app" "run the tests again and push the branch when green"
  line "2020-01-01T00:00:00Z" "/Users/x/dev/app" "what is a red-black tree and how does it rebalance"
  line "$(now)" "/private/tmp/agent-demo" "what is the idempotency key for in this demo payment"
  line "$(now)" "/Users/x/dev/app" "/model what is fast mode"
  line "$(now)" "/Users/x/dev/app" "what is it"
} > "$SB_QUESTION_LOG_DIR/a.jsonl"
{
  line "$(now)" "/Users/x/vaults/Seano/Learning" "explain why the row space and the null space are perpendicular"
  echo 'this line is not json'
  echo '{"ts":"2099-01-01T00:00:00Z","cwd":"/Users/x/dev/app","prompt":42}'
  echo '{"ts":"2099-01-01T00:00:00Z","cwd":42,"prompt":["what is this list doing here in the log"]}'
  echo '[1,2,3]'
  jq -cn --arg ts "$(now)" '{ts:$ts, prompt:"how does the clock algorithm pick a victim page"}'
  # A good prompt with a cwd of the wrong type: the line stays, the folder shows as -.
  jq -cn --arg ts "$(now)" '{ts:$ts, cwd:42, prompt:"what is a page fault and who handles it"}'
} > "$SB_QUESTION_LOG_DIR/b.jsonl"
before=$(cd "$SB_QUESTION_LOG_DIR" && cksum ./*.jsonl)
out=$(bash "$SWEEP" 2>&1); rc=$?
[ "$rc" = "0" ] && ok "exits 0" || no "exits 0" "rc=$rc out=$out"
echo "$out" | grep -q "row space and the null space" && ok "lists a concept question from the last 7 days" || no "lists a concept question from the last 7 days" "$out"
echo "$out" | grep -q "clock algorithm" && ok "reads every session log, and skips a malformed line" || no "reads every session log, and skips a malformed line" "$out"
[ "$(echo "$out" | grep -c "row space and the null space")" = "1" ] && ok "lists a repeated question once" || no "lists a repeated question once" "$out"
echo "$out" | grep -q "^[0-9-]*  -  how does the clock" && ok "shows - as the folder when a line has no cwd" || no "shows - as the folder when a line has no cwd" "$out"
echo "$out" | grep -q "^[0-9-]*  -  what is a page fault" && ok "keeps a good prompt whose cwd has the wrong type, with - as the folder" || no "keeps a good prompt whose cwd has the wrong type, with - as the folder" "rc=$rc out=$out"
echo "$out" | grep -q "red-black" && no "omits a question older than --days" "$out" || ok "omits a question older than --days"
echo "$out" | grep -q "idempotency" && no "omits temp-folder sessions" "$out" || ok "omits temp-folder sessions"
echo "$out" | grep -q "fast mode" && no "omits slash commands" "$out" || ok "omits slash commands"
echo "$out" | grep -q "run the tests again" && no "hides a prompt with no concept phrase by default" "$out" || ok "hides a prompt with no concept phrase by default"
echo "$out" | head -1 | grep -q "3 shown of 4" && ok "first line says how many are shown and how many are held back" || no "first line says how many are shown and how many are held back" "$(echo "$out" | head -1)"
echo "$out" | head -1 | grep -q "; 4 unreadable lines skipped$" && ok "first line counts the lines it could not read" || no "first line counts the lines it could not read" "$(echo "$out" | head -1)"
out=$(bash "$SWEEP" --all 2>&1)
echo "$out" | grep -q "run the tests again" && ok "--all shows prompts with no concept phrase" || no "--all shows prompts with no concept phrase" "$out"
echo "$out" | head -1 | grep -q "4 shown of 4" && ok "--all counts every kept prompt" || no "--all counts every kept prompt" "$(echo "$out" | head -1)"
out=$(bash "$SWEEP" --days 4000 2>&1)
echo "$out" | grep -q "red-black" && ok "--days widens the window" || no "--days widens the window" "$out"
after=$(cd "$SB_QUESTION_LOG_DIR" && cksum ./*.jsonl)
[ "$before" = "$after" ] && ok "never changes the logs" || no "never changes the logs" "logs differ"
bash "$SWEEP" --days soon >/dev/null 2>&1; [ "$?" = "2" ] && ok "refuses a --days value that is not a number" || no "refuses a --days value that is not a number" "wrong exit code"
bash "$SWEEP" --frobnicate >/dev/null 2>&1; [ "$?" = "2" ] && ok "refuses an unknown argument" || no "refuses an unknown argument" "wrong exit code"
teardown

# The sweep must never report a log as empty or shorter than it is without a word.
setup
mkdir -p "$SB_QUESTION_LOG_DIR"
real="$SB_QUESTION_LOG_DIR"
# Three files with no trailing newline: joined end to end, no line would parse.
for f in a b c; do printf '%s' "$(line "$(now)" "/Users/x/dev/app" "explain how topic $f works in detail")" > "$real/$f.jsonl"; done
out=$(bash "$SWEEP" 2>&1)
echo "$out" | head -1 | grep -q "3 shown of 3" && ok "keeps the last line of a file that has no trailing newline" || no "keeps the last line of a file that has no trailing newline" "$(echo "$out" | head -1)"
echo "$out" | head -1 | grep -q "unreadable" && no "says nothing about unreadable lines when there are none" "$(echo "$out" | head -1)" || ok "says nothing about unreadable lines when there are none"
# A write that was cut short drops its own line only, and the first line says so.
printf '%s' '{"ts":"2099-01-01T00:00:00Z","cwd":"/Users/x","prompt":"what is a half writ' > "$real/d.jsonl"
out=$(bash "$SWEEP" 2>&1)
echo "$out" | head -1 | grep -q "3 shown of 3.*; 1 unreadable line skipped$" && ok "drops a cut-short line alone and counts it in the first line" || no "drops a cut-short line alone and counts it in the first line" "$(echo "$out" | head -1)"
# A timestamp that is not a date cannot be placed in the window: unreadable, not shown for ever.
echo '{"ts":"zzzz","cwd":"/Users/x/dev/app","prompt":"what is a timestamp that is not a date"}' > "$real/d.jsonl"
out=$(bash "$SWEEP" 2>&1)
{ ! echo "$out" | grep -q "not a date" && echo "$out" | head -1 | grep -q "; 1 unreadable line skipped$"; } && ok "treats a timestamp that is not a date as unreadable" || no "treats a timestamp that is not a date as unreadable" "$out"
rm "$real/d.jsonl"
# A symlink to the log folder is the log folder.
ln -s "$real" "$TD/link"
out=$(SB_QUESTION_LOG_DIR="$TD/link" bash "$SWEEP" 2>&1)
echo "$out" | head -1 | grep -q "3 shown of 3" && ok "reads a log folder that is a symlink" || no "reads a log folder that is a symlink" "$(echo "$out" | head -1)"
# What it cannot read is an error, never an empty or a shorter log. (Root reads everything.)
if [ "$(id -u)" != "0" ]; then
  chmod 000 "$real"
  out=$(bash "$SWEEP" 2>&1); rc=$?
  chmod 700 "$real"
  { [ "$rc" = "2" ] && ! echo "$out" | grep -q "shown of"; } && ok "refuses a log folder it cannot read" || no "refuses a log folder it cannot read" "rc=$rc out=$out"
  chmod 000 "$real/a.jsonl"
  out=$(bash "$SWEEP" 2>&1); rc=$?
  chmod 600 "$real/a.jsonl"
  { [ "$rc" = "2" ] && ! echo "$out" | grep -q "shown of"; } && ok "refuses to report when one log file cannot be read" || no "refuses to report when one log file cannot be read" "rc=$rc out=$out"
fi
teardown

# What counts as a slash command, a temp folder and a folder name.
setup
mkdir -p "$SB_QUESTION_LOG_DIR"
{
  line "$(now)" "/Users/x/dev/app" "/Users/me/notes.md what is this file about"
  line "$(now)" "/Users/x/dev/app" "/code-review:code-review what is the scope here"
  line "$(now)" "/Users/x/dev/app" "/plugin"
  line "$(now)" "/var/tmp/agent-run" "what is a session in a var tmp folder"
  line "$(now)" "/private/var/tmp/agent-run" "what is a session in a private var tmp folder"
  line "$(now)" "/" "what is the root folder doing as a cwd"
  line "$(now)" "/Users/x/dev/trailing/" "what is a cwd with a trailing slash"
} > "$SB_QUESTION_LOG_DIR/a.jsonl"
out=$(bash "$SWEEP" --all 2>&1)
echo "$out" | grep -q "notes.md what is this file" && ok "keeps a prompt that starts with a file path" || no "keeps a prompt that starts with a file path" "$out"
echo "$out" | grep -q "code-review" && no "omits a namespaced slash command" "$out" || ok "omits a namespaced slash command"
echo "$out" | grep -q "var tmp folder" && no "omits sessions under /var/tmp and /private/var/tmp" "$out" || ok "omits sessions under /var/tmp and /private/var/tmp"
echo "$out" | grep -q "^[0-9-]*  -  what is the root folder" && ok "shows - as the folder for a cwd of /" || no "shows - as the folder for a cwd of /" "$out"
echo "$out" | grep -q "^[0-9-]*  trailing  what is a cwd with" && ok "names the folder of a cwd that ends in a slash" || no "names the folder of a cwd that ends in a slash" "$out"
echo "$out" | head -1 | grep -q "3 shown of 3" && ok "counts exactly the three kept prompts" || no "counts exactly the three kept prompts" "$(echo "$out" | head -1)"
out=$(bash "$SWEEP" --days 99999 2>&1); rc=$?
{ [ "$rc" = "2" ] && echo "$out" | grep -q "at most 36500" && [ "$(echo "$out" | wc -l | tr -d ' ')" = "1" ]; } && ok "refuses a --days value over 36500 in one line" || no "refuses a --days value over 36500 in one line" "rc=$rc out=$out"
out=$(bash "$SWEEP" --days 9223372036854775807 2>&1); rc=$?
[ "$rc" = "2" ] && ok "refuses a --days value that overflows" || no "refuses a --days value that overflows" "rc=$rc out=$out"
out=$(bash "$SWEEP" --days 000007 --all 2>&1); rc=$?
{ [ "$rc" = "0" ] && echo "$out" | head -1 | grep -q "last 7 days: 3 shown of 3"; } && ok "reads --days 000007 as 7" || no "reads --days 000007 as 7" "rc=$rc out=$out"
# A log path that exists and is not a folder is a mistake, never an empty log.
out=$(SB_QUESTION_LOG_DIR="$SB_QUESTION_LOG_DIR/a.jsonl" bash "$SWEEP" 2>&1); rc=$?
{ [ "$rc" = "2" ] && ! echo "$out" | grep -q "shown of"; } && ok "refuses a log path that is a file" || no "refuses a log path that is a file" "rc=$rc out=$out"
out=$(bash "$SWEEP" --days 36500 --all 2>&1); rc=$?
{ [ "$rc" = "0" ] && echo "$out" | head -1 | grep -q "3 shown of 3"; } && ok "accepts --days 36500" || no "accepts --days 36500" "rc=$rc out=$out"
teardown

setup
out=$(bash "$SWEEP" 2>&1); rc=$?
{ [ "$rc" = "0" ] && echo "$out" | grep -q "0 shown of 0"; } && ok "reports an empty window when there is no log folder" || no "reports an empty window when there is no log folder" "rc=$rc out=$out"
[ ! -e "$SB_QUESTION_LOG_DIR" ] && ok "does not create the log folder" || no "does not create the log folder" "folder was created"
teardown

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
