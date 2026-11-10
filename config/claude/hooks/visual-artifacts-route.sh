#!/bin/bash
# PreToolUse hook (matcher: Artifact): send plain-page builds to the
# visual-artifacts skill. The Artifact tool's built-in rules make quickstart
# the first call, and its generic artifact-design text then crowds out the
# skill. Deny quickstart unless the intent names a doc, deck or design canvas;
# the deny reason tells Claude to load the skill and publish directly, and
# names brief-artifact for a decision brief or a short report.
input=$(cat)
tool=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)
action=$(printf '%s' "$input" | jq -r '.tool_input.action // empty' 2>/dev/null)
intent=$(printf '%s' "$input" | jq -r '.tool_input.intent // empty' 2>/dev/null)

[ "$tool" = "Artifact" ] && [ "$action" = "quickstart" ] || exit 0
case "$intent" in document|slides|design) exit 0 ;; esac

reason="Skip quickstart for HTML pages. Load the visual-artifacts skill with the
Skill tool (unless this session already loaded it), follow it, and publish the
page directly; the skill carries the page contract and replaces the
artifact-design guidance. A decision brief or a short build or review report
is the brief-artifact skill instead: publish the page its script built,
directly. Exception: if the user explicitly asked for a
ready-made type (such as Dashboard), get its type_url with action \"list\",
scope \"types\"; if they named a different skill or look, follow that instead."

jq -cn --arg r "$reason" \
  '{hookSpecificOutput:{hookEventName:"PreToolUse", permissionDecision:"deny", permissionDecisionReason:$r}}'
exit 0
