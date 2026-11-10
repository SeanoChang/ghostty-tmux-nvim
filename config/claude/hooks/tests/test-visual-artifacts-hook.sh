#!/bin/bash
# Tests for the PreToolUse hook that sends plain-page Artifact builds to the
# visual-artifacts skill instead of the Artifact quickstart.
# Run: bash ~/.claude/hooks/tests/test-visual-artifacts-hook.sh
HOOKS="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$HOOKS/visual-artifacts-route.sh"
pass=0; fail=0
ok(){ printf '  \033[32mPASS\033[0m %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[31mFAIL\033[0m %s\n     %s\n' "$1" "$2"; fail=$((fail+1)); }
run(){ printf '%s' "$1" | bash "$HOOK" 2>/dev/null; }
call(){ printf '{"session_id":"s1","hook_event_name":"PreToolUse","tool_name":"Artifact","tool_input":%s}' "$1"; }

echo "== visual-artifacts-route.sh =="

out=$(run "$(call '{"action":"quickstart","intent":"other","design_systems":false}')")
[ "$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)" = "deny" ] \
  && ok "denies quickstart for a plain page (intent other)" || no "denies quickstart for a plain page (intent other)" "got: $out"
printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason' 2>/dev/null | grep -q 'visual-artifacts' \
  && ok "deny reason names the visual-artifacts skill" || no "deny reason names the visual-artifacts skill" "got: $out"
printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason' 2>/dev/null | grep -q 'brief-artifact' \
  && ok "deny reason says a brief-artifact page is published directly" || no "deny reason says a brief-artifact page is published directly" "got: $out"
[ "$(printf '%s' "$out" | jq -r '.hookSpecificOutput.hookEventName' 2>/dev/null)" = "PreToolUse" ] \
  && ok "output carries hookEventName PreToolUse" || no "output carries hookEventName PreToolUse" "got: $out"

out=$(run "$(call '{"action":"quickstart"}')")
[ "$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision' 2>/dev/null)" = "deny" ] \
  && ok "denies quickstart with no intent" || no "denies quickstart with no intent" "got: $out"

for intent in document slides design; do
  out=$(run "$(call "{\"action\":\"quickstart\",\"intent\":\"$intent\"}")"); rc=$?
  { [ -z "$out" ] && [ "$rc" = 0 ]; } \
    && ok "passes quickstart with intent $intent (user named a doc, deck or design)" \
    || no "passes quickstart with intent $intent" "rc=$rc out: $out"
done

out=$(run "$(call '{"file_path":"/tmp/page.html","icon":"chart"}')"); rc=$?
{ [ -z "$out" ] && [ "$rc" = 0 ]; } && ok "passes a publish" || no "passes a publish" "rc=$rc out: $out"

out=$(run "$(call '{"action":"read","url":"https://claude.ai/artifact/x"}')"); rc=$?
{ [ -z "$out" ] && [ "$rc" = 0 ]; } && ok "passes a read" || no "passes a read" "rc=$rc out: $out"

out=$(run 'not json'); rc=$?
{ [ -z "$out" ] && [ "$rc" = 0 ]; } && ok "fails open on malformed input" || no "fails open on malformed input" "rc=$rc out: $out"

echo
echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
