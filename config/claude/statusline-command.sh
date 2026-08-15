#!/bin/bash
input=$(cat)

# ── raw data ─────────────────────────────────────────────────────────────────
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // ""')
model=$(echo "$input" | jq -r '.model.display_name // ""')
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
remaining_pct=$(echo "$input" | jq -r '.context_window.remaining_percentage // empty')
ctx_input=$(echo "$input" | jq -r '.context_window.current_usage.input_tokens // empty')
ctx_output=$(echo "$input" | jq -r '.context_window.current_usage.output_tokens // empty')
ctx_window=$(echo "$input" | jq -r '.context_window.context_window_size // empty')
five_h=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
five_h_reset=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
seven_d=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
seven_d_reset=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')
vim_mode=$(echo "$input" | jq -r '.vim.mode // empty')
output_style=$(echo "$input" | jq -r '.output_style.name // empty')
session_name=$(echo "$input" | jq -r '.session_name // empty')

user=$(whoami)
host=$(hostname -s)

# ── helper: format epoch as "resets in Xh Ym" or "resets in Ym" ─────────────
format_reset() {
  _epoch="$1"
  [ -z "$_epoch" ] && return
  _now=$(date +%s)
  _diff=$(( _epoch - _now ))
  [ "$_diff" -le 0 ] && printf "resetting" && return
  _h=$(( _diff / 3600 ))
  _m=$(( (_diff % 3600) / 60 ))
  if [ "$_h" -gt 0 ]; then
    printf "%dh %dm" "$_h" "$_m"
  else
    printf "%dm" "$_m"
  fi
}

# ── helper: compact number (1500 → 1.5k, 200000 → 200k) ─────────────────────
fmt_num() {
  _n="$1"
  [ -z "$_n" ] && return
  if [ "$_n" -ge 1000 ] 2>/dev/null; then
    printf "%.0fk" "$(echo "$_n" | awk '{printf "%.1f", $1/1000}')"
  else
    printf "%s" "$_n"
  fi
}

# ── build output parts ────────────────────────────────────────────────────────
parts=""

add() {
  [ -z "$1" ] && return
  [ -n "$parts" ] && parts="${parts} | "
  parts="${parts}$1"
}

# 1. user@host
add "${user}@${host}"

# 2. directory
short_dir=$(echo "$cwd" | sed "s|^$HOME|~|")
add "${short_dir}"

# 3. git branch
if git -C "$cwd" rev-parse --git-dir > /dev/null 2>&1; then
  branch=$(git -C "$cwd" --no-optional-locks symbolic-ref --short HEAD 2>/dev/null || \
           git -C "$cwd" --no-optional-locks rev-parse --short HEAD 2>/dev/null)
  dirty=""
  git -C "$cwd" --no-optional-locks diff --quiet 2>/dev/null        || dirty="*"
  git -C "$cwd" --no-optional-locks diff --cached --quiet 2>/dev/null || dirty="*"
  ahead=$(git -C "$cwd" --no-optional-locks rev-list --count @{u}..HEAD 2>/dev/null || echo 0)
  behind=$(git -C "$cwd" --no-optional-locks rev-list --count HEAD..@{u} 2>/dev/null || echo 0)
  arrows=""
  [ "$ahead"  -gt 0 ] 2>/dev/null && arrows="${arrows} +${ahead}"
  [ "$behind" -gt 0 ] 2>/dev/null && arrows="${arrows} -${behind}"
  add "git:${branch}${dirty}${arrows}"
fi

# 4. model
add "model:${model}"

# 5. context window
if [ -n "$used_pct" ] && [ -n "$remaining_pct" ]; then
  used_int=$(printf '%.0f' "$used_pct")
  rem_int=$(printf '%.0f' "$remaining_pct")
  ctx_str="ctx:${used_int}% used / ${rem_int}% left"
  if [ -n "$ctx_input" ] && [ -n "$ctx_window" ]; then
    ctx_str="${ctx_str} ($(fmt_num "$ctx_input")/$(fmt_num "$ctx_window") tokens)"
  fi
  add "$ctx_str"
fi

# 6. rate limits
if [ -n "$five_h" ]; then
  five_int=$(printf '%.0f' "$five_h")
  five_str="5h:${five_int}% used"
  if [ -n "$five_h_reset" ]; then
    five_str="${five_str}, resets in $(format_reset "$five_h_reset")"
  fi
  add "$five_str"
fi

if [ -n "$seven_d" ]; then
  seven_int=$(printf '%.0f' "$seven_d")
  seven_str="7d:${seven_int}% used"
  if [ -n "$seven_d_reset" ]; then
    seven_str="${seven_str}, resets in $(format_reset "$seven_d_reset")"
  fi
  add "$seven_str"
fi

# 7. vim mode
[ -n "$vim_mode" ] && add "vim:${vim_mode}"

# 8. output style / session name
if [ -n "$output_style" ] && [ "$output_style" != "default" ] && [ "$output_style" != "Default" ]; then
  add "style:${output_style}"
fi
[ -n "$session_name" ] && add "session:${session_name}"

# ── output ────────────────────────────────────────────────────────────────────
printf '%s' "$parts"
