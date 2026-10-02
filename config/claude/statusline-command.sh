#!/bin/sh
# Claude Code status line — two lines, TokyoNight Moon palette (same as tmux.conf §6)
#   line 1: [ssh host]  dir │  branch* ↑↓ │ <tier icon> model <pie> effort │ vim │ style │ session
#   line 2: 󰍛 context bar │ 5h bar + reset │ 7d bar + reset
# Runs under macOS /bin/sh (bash 3.2, POSIX mode): no \u escapes, so glyphs are octal UTF-8.
input=$(cat)

# ── raw data (one jq call; @sh quotes every value for eval) ──────────────────
eval "$(printf '%s' "$input" | jq -r '
  def pct: if type == "number" then (. + 0.5 | floor) else "" end;
  .context_window as $cw | .rate_limits as $rl |
  @sh "cwd=\(.workspace.current_dir // .cwd // "")",
  @sh "model=\(.model.display_name // "")",
  @sh "model_id=\(.model.id // "")",
  @sh "effort=\(.effort.level // "")",
  @sh "ctx_pct=\($cw.used_percentage | pct)",
  @sh "ctx_used=\($cw.current_usage // null | if . then ((.input_tokens // 0) + (.cache_creation_input_tokens // 0) + (.cache_read_input_tokens // 0)) else "" end)",
  @sh "ctx_size=\($cw.context_window_size // "")",
  @sh "five_pct=\($rl.five_hour.used_percentage | pct)",
  @sh "five_reset=\($rl.five_hour.resets_at // "")",
  @sh "seven_pct=\($rl.seven_day.used_percentage | pct)",
  @sh "seven_reset=\($rl.seven_day.resets_at // "")",
  @sh "vim_mode=\(.vim.mode // "")",
  @sh "output_style=\(.output_style.name // "")",
  @sh "session_name=\(.session_name // "")"
')"

# ── palette (TokyoNight Moon, truecolor) ─────────────────────────────────────
ESC=$(printf '\033')
RST="${ESC}[0m"
fg() { printf '%s[38;2;%sm' "$ESC" "$1"; }
BLUE=$(fg "130;170;255")
MAGENTA=$(fg "192;153;255")
YELLOW=$(fg "255;199;119")
ORANGE=$(fg "255;150;108")
GREEN=$(fg "195;232;141")
RED=$(fg "255;117;127")
CYAN=$(fg "134;225;252")
FGD=$(fg "130;139;184")
DIM=$(fg "68;74;115")

# ── glyphs ───────────────────────────────────────────────────────────────────
I_DIR=$(printf '\357\201\274')         # nf-fa-folder_open
I_BRANCH=$(printf '\356\202\240')      # powerline branch
I_MODEL=$(printf '\363\260\232\251')   # nf-md-robot (unknown model)
I_HAIKU=$(printf '\363\260\214\252')   # nf-md-leaf
I_SONNET=$(printf '\363\260\235\232')  # nf-md-music_note
I_OPUS=$(printf '\363\260\247\221')    # nf-md-brain
I_FABLE=$(printf '\363\261\221\267')   # nf-md-wizard_hat
I_EFF1=$(printf '\363\260\252\237')    # nf-md-circle_slice_2  low
I_EFF2=$(printf '\363\260\252\241')    # nf-md-circle_slice_4  medium
I_EFF3=$(printf '\363\260\252\243')    # nf-md-circle_slice_6  high
I_EFF4=$(printf '\363\260\252\244')    # nf-md-circle_slice_7  xhigh
I_EFF5=$(printf '\363\260\252\245')    # nf-md-circle_slice_8  max
I_CTX=$(printf '\363\260\215\233')     # nf-md-memory
I_CLOCK=$(printf '\357\200\227')       # nf-fa-clock_o
I_VIM=$(printf '\356\230\253')         # nf-custom-vim
I_STYLE=$(printf '\363\260\217\230')   # nf-md-palette
I_TAG=$(printf '\357\200\253')         # nf-fa-tag
I_HOST=$(printf '\363\260\214\230')    # nf-md-lan
FULL=$(printf '\342\226\260')          # ▰
EMPTY=$(printf '\342\226\261')         # ▱
SEP=" ${DIM}$(printf '\342\224\202')${RST} "   # │
UP=$(printf '\342\206\221')            # ↑
DOWN=$(printf '\342\206\223')          # ↓

# ── helpers ──────────────────────────────────────────────────────────────────
# compact number: 1500 → 1.5k, 60940 → 61k, 1000000 → 1M
fmt_num() {
  awk -v n="$1" 'BEGIN {
    if (n >= 1000000)    { s = sprintf("%.1f", n/1000000); sub(/\.0$/, "", s); print s "M" }
    else if (n >= 10000) printf "%.0fk\n", n/1000
    else if (n >= 1000)  { s = sprintf("%.1f", n/1000); sub(/\.0$/, "", s); print s "k" }
    else print n }'
}

# epoch → time until reset: 3d4h / 2h14m / 9m
fmt_reset() {
  [ -z "$1" ] && return
  _d=$(( $1 - $(date +%s) ))
  [ "$_d" -le 0 ] && { printf 'now'; return; }
  _days=$(( _d / 86400 )); _h=$(( (_d % 86400) / 3600 )); _m=$(( (_d % 3600) / 60 ))
  if   [ "$_days" -gt 0 ]; then printf '%dd%dh' "$_days" "$_h"
  elif [ "$_h" -gt 0 ];    then printf '%dh%02dm' "$_h" "$_m"
  else                          printf '%dm' "$_m"
  fi
}

# usage color: blue < 80 ≤ red
level() {
  if [ "$1" -ge 80 ]; then printf '%s' "$RED"
  else                     printf '%s' "$BLUE"
  fi
}

# bar PCT WIDTH → ▰▰▰▱▱ 42%
bar() {
  _c=$(level "$1")
  _f=$(( ($1 * $2 + 50) / 100 )); [ "$_f" -gt "$2" ] && _f=$2
  _s="$_c"; _i=0
  while [ "$_i" -lt "$_f" ]; do _s="$_s$FULL"; _i=$((_i + 1)); done
  _s="$_s$DIM"
  while [ "$_i" -lt "$2" ]; do _s="$_s$EMPTY"; _i=$((_i + 1)); done
  printf '%s %s%d%%%s' "$_s" "$_c" "$1" "$RST"
}

line=""
add() { [ -z "$1" ] && return; [ -n "$line" ] && line="$line$SEP"; line="$line$1"; }

# ── line 1: where ────────────────────────────────────────────────────────────
[ -n "$SSH_CONNECTION" ] && add "${CYAN}${I_HOST} $(hostname -s)${RST}"

# directory: repo-relative inside git ("repo/sub/dir"), ~-relative otherwise
root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)
if [ -n "$root" ]; then
  dir="${root##*/}${cwd#"$root"}"
else
  dir=$(printf '%s' "$cwd" | sed "s|^$HOME|~|" | awk -F/ 'NF > 4 { print $1 "/…/" $(NF-1) "/" $NF; next } { print }')
fi
[ -n "$dir" ] && add "${BLUE}${I_DIR} ${dir}${RST}"

# git: one status call gives branch, ahead/behind, and dirty (tracked files only)
if [ -n "$root" ]; then
  read -r branch ahead behind dirty <<EOF
$(git -C "$cwd" --no-optional-locks status --porcelain=v2 --branch -uno 2>/dev/null | awk '
  /^# branch.oid/  { oid = substr($3, 1, 7) }
  /^# branch.head/ { head = $3 }
  /^# branch.ab/   { a = substr($3, 2); b = substr($4, 2) }
  /^[12u] /        { d = 1 }
  END { if (head == "(detached)") head = oid; print head, a + 0, b + 0, d + 0 }')
EOF
  g="${MAGENTA}${I_BRANCH} ${branch}"
  [ "$dirty" = 1 ] && g="$g${YELLOW}*"
  [ "$ahead" -gt 0 ] 2>/dev/null && g="$g ${GREEN}${UP}${ahead}"
  [ "$behind" -gt 0 ] 2>/dev/null && g="$g ${RED}${DOWN}${behind}"
  add "$g$RST"
fi

# model: icon + color by tier; effort: pie fills and warms with level
case "$model_id" in
  *haiku*)  m="${GREEN}${I_HAIKU}" ;;
  *sonnet*) m="${CYAN}${I_SONNET}" ;;
  *opus*)   m="${ORANGE}${I_OPUS}" ;;
  *fable*)  m="${YELLOW}${I_FABLE}" ;;
  *)        m="${FGD}${I_MODEL}" ;;
esac
case "$effort" in
  low)    e="${GREEN}${I_EFF1}" ;;
  medium) e="${GREEN}${I_EFF2}" ;;
  high)   e="${YELLOW}${I_EFF3}" ;;
  xhigh)  e="${ORANGE}${I_EFF4}" ;;
  max)    e="${RED}${I_EFF5}" ;;
  *)      e="${FGD}" ;;
esac
[ -n "$model" ] && m="$m ${model}" || m=""
[ -n "$effort" ] && m="${m:+$m }$e ${effort}"
[ -n "$m" ] && add "$m$RST"

case "$vim_mode" in
  "")      ;;
  INSERT)  add "${GREEN}${I_VIM} ${vim_mode}${RST}" ;;
  *)       add "${BLUE}${I_VIM} ${vim_mode}${RST}" ;;
esac

case "$output_style" in
  ""|default|Default) ;;
  *) add "${FGD}${I_STYLE} ${output_style}${RST}" ;;
esac

[ -n "$session_name" ] && add "${FGD}${I_TAG} ${session_name}${RST}"

line1=$line

# ── line 2: budgets ──────────────────────────────────────────────────────────
line=""
if [ -n "$ctx_pct" ]; then
  c="${FGD}${I_CTX}${RST} $(bar "$ctx_pct" 20)"
  [ -n "$ctx_used" ] && [ -n "$ctx_size" ] && \
    c="$c ${FGD}$(fmt_num "$ctx_used")/$(fmt_num "$ctx_size")${RST}"
  add "$c"
fi

if [ -n "$five_pct" ]; then
  r="${FGD}5h${RST} $(bar "$five_pct" 10)"
  [ -n "$five_reset" ] && r="$r ${DIM}${I_CLOCK} $(fmt_reset "$five_reset")${RST}"
  add "$r"
fi

if [ -n "$seven_pct" ]; then
  r="${FGD}7d${RST} $(bar "$seven_pct" 10)"
  [ -n "$seven_reset" ] && r="$r ${DIM}${I_CLOCK} $(fmt_reset "$seven_reset")${RST}"
  add "$r"
fi

# ── output ───────────────────────────────────────────────────────────────────
printf '%s' "$line1"
[ -n "$line" ] && printf '\n%s' "$line"

# ccdash capture — only on machines where ccdash has run
if [ -d "$HOME/.local/share/ccdash" ]; then
  printf '%s\n' "$input" >> "$HOME/.local/share/ccdash/statusline.jsonl"
fi
