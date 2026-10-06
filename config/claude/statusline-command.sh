#!/bin/sh
# Claude Code status line — up to five lines, TokyoNight Moon palette (same as tmux.conf §6)
#   line 1: [ssh host]  dir │  branch* ↑↓ │ <tier icon> model <pie> effort │ vim │ style │ session
#   line 2: 󰍛 context bar │ 5h bar + reset │ 7d bar + reset
#   line 3: context split, fixed overhead vs chat (needs the context-feed mod)
#   line 4: the fixed overhead by part: tools, system, mcp, memory, skills, agents
#   line 5: prompt cache: TTL draining bar, hit ratio, misses, cold-rebuild cost
# Test overrides: STATUSLINE_NOW (epoch), STATUSLINE_BREAKDOWN (feed file), STATUSLINE_BAR_GLYPH.
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

# ── lines 3-4: what fills the context ────────────────────────────────────────
# Line 3 splits the used context into fixed overhead and conversation; line 4
# zooms into the overhead, so its small parts get a readable width.
# Categories come from the context-feed mod: ~/.cache/claude-statusline/<session>.json
# ({"categories":[{"name":"system","tokens":9000},...]}). Missing file: no lines.
I_LAYERS=$(printf '\363\260\214\250')  # nf-md-layers
I_ZOOM=$(printf '\363\260\215\211')    # nf-md-magnify
session_id=$(printf '%s' "$input" | jq -r '.session_id // ""')
feed="${STATUSLINE_BREAKDOWN:-$HOME/.cache/claude-statusline/$session_id.json}"
line3=""
if [ -n "$session_id" ] && [ -f "$feed" ]; then
  bars=$(jq -r '.categories[] | "\(.name) \(.tokens)"' "$feed" 2>/dev/null | awk -v G="${STATUSLINE_BAR_GLYPH:-━}" '
    function rgb(n) {
      if (n == "system" || n == "sys") return "130;170;255"; if (n == "tools") return "134;225;252"
      if (n == "mcp") return "192;153;255";    if (n == "agents" || n == "agt") return "79;214;190"
      if (n == "memory" || n == "mem") return "255;199;119"; if (n == "skills") return "195;232;141"
      if (n == "messages" || n == "chat") return "255;150;108"
      if (n == "fixed") return "79;214;190";  return "130;139;184"
    }
    function alias(n) {
      if (n == "system") return "sys"; if (n == "memory") return "mem"; if (n == "agents") return "agt"
      return n
    }
    function short(t,   s) {
      if (t >= 1000000) return sprintf("%.1fM", t / 1e6)
      if (t >= 10000) return sprintf("%.0fk", t / 1e3)
      if (t >= 1000) { s = sprintf("%.1fk", t / 1e3); sub(/\.0k$/, "k", s); return s }
      return t
    }
    # draw(k, W): stacked bar of nm[1..k] / tk[1..k] in W glyphs, then a legend
    # with the tokens and share of each part. G is the glyph (STATUSLINE_BAR_GLYPH).
    function draw(k, W,   i, j, tot, sum, big, c, pct, out, legend) {
      for (i = 1; i <= k; i++) tot += tk[i]
      big = 1
      for (i = 1; i <= k; i++) {
        c[i] = int(tk[i] * W / tot + 0.5); if (c[i] < 1) c[i] = 1
        sum += c[i]; if (tk[i] > tk[big]) big = i
      }
      c[big] += W - sum
      for (i = 1; i <= k; i++) {
        pct = int(tk[i] * 100 / tot + 0.5)
        out = out sprintf("%s38;2;%sm", E, rgb(nm[i]))
        for (j = 0; j < c[i]; j++) out = out G
        legend = legend sprintf("  %s38;2;%sm%s %s%s38;2;130;139;184m %s", E, rgb(nm[i]), nm[i], pct "%", E, short(tk[i]))
      }
      return out E "0m" legend E "0m"
    }
    $2 > 0 { n++; name[n] = $1; tok[n] = $2; total += $2; if ($1 != "messages") fixed += $2 }
    END {
      if (total == 0) exit
      E = "\033["
      nm[1] = "fixed"; tk[1] = fixed; nm[2] = "chat"; tk[2] = total - fixed
      print draw(2, 30)
      # overhead parts, biggest first
      k = 0
      for (i = 1; i <= n; i++) if (name[i] != "messages") { k++; nm[k] = alias(name[i]); tk[k] = tok[i] }
      for (i = 2; i <= k; i++) for (j = i; j > 1 && tk[j] > tk[j - 1]; j--) {
        t = tk[j]; tk[j] = tk[j - 1]; tk[j - 1] = t; s = nm[j]; nm[j] = nm[j - 1]; nm[j - 1] = s
      }
      if (k > 0) print draw(k, 30)
    }')
  if [ -n "$bars" ]; then
    line3="${FGD}${I_LAYERS}${RST} $(printf '%s\n' "$bars" | sed -n 1p)"
    z=$(printf '%s\n' "$bars" | sed -n 2p)
    [ -n "$z" ] && line3="$line3
${FGD}${I_ZOOM}${RST} ${DIM}fixed${RST} $z"
  fi
fi
I_CACHE=$(printf '\363\260\203\250')   # nf-md-cached
I_SNOW=$(printf '\363\260\234\227')    # nf-md-snowflake
I_FIRE=$(printf '\363\260\210\270')    # nf-md-fire
I_TARGET=$(printf '\363\260\223\276')  # nf-md-target
I_CASH=$(printf '\363\260\204\224')    # nf-md-cash
I_RECYCLE=$(printf '\363\260\221\223') # nf-md-recycle
DOT=$(printf '\342\227\217')           # ●
RING=$(printf '\342\227\213')          # ○
HALF=$(printf '\342\227\220')          # ◐
TEAL=$(fg "79;214;190")
# ── line 5: prompt cache (TTL draining bar, hit gauge, rebuild risk) ────────
eval "$(printf '%s' "$input" | jq -r '
  .prompt_cache as $p |
  @sh "pc_warm=\($p.warm // "")",
  @sh "pc_ttl=\($p.ttl // "")",
  @sh "pc_exp=\($p.expires_at // "")",
  @sh "pc_hit=\(if $p.hit_ratio then ($p.hit_ratio * 100 + 0.5 | floor) else "" end)",
  @sh "pc_miss=\($p.misses // 0)",
  @sh "pc_rebuild=\($p.recache_tokens_if_cold // "")",
  @sh "pc_cause=\($p.last_miss_cause.causes[0]? // "")",
  @sh "cost_usd=\(.cost.total_cost_usd // "")"
')"

# 1h-write price per MTok by model (2x base input), for the rebuild estimate
case "$model_id" in
  *fable*) wprice=20 ;; *opus-5-5*) wprice=8 ;; *opus*) wprice=10 ;;
  *sonnet*) wprice=4 ;; *haiku*) wprice=2 ;; *) wprice=8 ;;
esac

# seconds → 42m / 1h05m
fmt_dur() { if [ "$1" -ge 3600 ]; then printf "%dh%02dm" $(($1 / 3600)) $(($1 % 3600 / 60)); else printf "%dm" $((($1 + 59) / 60)); fi; }

# drain BAR: cells left of the TTL, colored by urgency
drain() {
  _left=$1; _span=$2; _w=$3
  _f=$(( (_left * _w + _span - 1) / _span )); [ "$_f" -gt "$_w" ] && _f=$_w
  if   [ "$_left" -le 300 ];  then _c=$RED
  elif [ "$_left" -le 1200 ]; then _c=$YELLOW
  else                             _c=$GREEN
  fi
  _s="$_c"; _i=0
  while [ "$_i" -lt "$_f" ]; do _s="$_s$FULL"; _i=$((_i + 1)); done
  _s="$_s$DIM"; while [ "$_i" -lt "$_w" ]; do _s="$_s$EMPTY"; _i=$((_i + 1)); done
  printf '%s' "$_s"
}

line4=""
if [ -n "$pc_ttl" ]; then
  now=${STATUSLINE_NOW:-$(date +%s)}
  case "$pc_ttl" in 5m) span=300 ;; *) span=3600 ;; esac
  # The cache-keepalive mod reads the cache from a fork, which this payload does
  # not see: a keep-alive after the recorded expiry was set restarts the TTL.
  ka="${STATUSLINE_KEEPALIVE:-$HOME/.cache/claude-statusline/$session_id.keepalive.json}"
  ka_n=""; ka_max=""
  if [ -n "$session_id" ] && [ -f "$ka" ]; then
    read -r ka_n ka_max ka_at <<KA
$(jq -r '"\(.refreshes // 0) \(.max // 3) \(.lastAt // 0)"' "$ka" 2>/dev/null)
KA
    if [ "${ka_at:-0}" -gt 0 ] 2>/dev/null && [ $((ka_at + span)) -gt "${pc_exp:-0}" ]; then
      pc_exp=$((ka_at + span)); pc_warm=true
    fi
  fi
  left=$(( ${pc_exp:-0} - now ))
  rb=""
  [ -n "$pc_rebuild" ] && rb="$(fmt_num "$pc_rebuild") $(awk -v t="$pc_rebuild" -v p="$wprice" 'BEGIN { printf "≈$%.2f", t * p / 1e6 }')"
  if [ "$pc_warm" = true ] && [ "$left" -gt 0 ]; then
    if   [ "$left" -le 300 ];  then st="${RED}${I_FIRE} expiring"
    elif [ "$left" -le 1200 ]; then st="${YELLOW}${HALF} cooling"
    else                            st="${GREEN}${DOT} warm"
    fi
    c4="${FGD}${I_CACHE}${RST} $st${RST} $(drain "$left" "$span" 12) ${FGD}$(fmt_dur "$left")${DIM}/${pc_ttl}${RST}"
    [ -n "$rb" ] && c4="$c4 ${DIM}cold rebuild ${rb}${RST}"
  else
    c4="${FGD}${I_CACHE}${RST} ${CYAN}${I_SNOW} cold${RST} ${DIM}$(drain 0 "$span" 12)${RST} ${CYAN}next turn rebuilds ${rb}${RST}"
  fi
  [ "${ka_n:-0}" -gt 0 ] 2>/dev/null && c4="$c4 ${TEAL}${I_RECYCLE} ${ka_n}/${ka_max}${RST}"
  line4="$c4"
  if [ -n "$pc_hit" ]; then
    hc=$GREEN; [ "$pc_hit" -lt 90 ] && hc=$YELLOW; [ "$pc_hit" -lt 70 ] && hc=$RED
    hf=$(( (pc_hit + 5) / 10 )); hs="$hc"; k=0
    while [ "$k" -lt "$hf" ]; do hs="$hs$FULL"; k=$((k + 1)); done
    hs="$hs$DIM"; while [ "$k" -lt 10 ]; do hs="$hs$EMPTY"; k=$((k + 1)); done
    line4="$line4$SEP${FGD}${I_TARGET} hit${RST} $hs ${hc}${pc_hit}%${RST}"
  fi
  if [ "$pc_miss" -gt 0 ] 2>/dev/null; then
    line4="$line4$SEP${RED}${pc_miss} miss${RST}${DIM} ${pc_cause}${RST}"
  else
    line4="$line4$SEP${GREEN}0 miss${RST}"
  fi
  [ -n "$cost_usd" ] && line4="$line4$SEP${FGD}${I_CASH} $(awk -v c="$cost_usd" 'BEGIN { printf "$%.2f", c }')${RST}"
fi

# ── output ───────────────────────────────────────────────────────────────────
printf '%s' "$line1"
[ -n "$line" ] && printf "\n%s" "$line"
[ -n "$line3" ] && printf "\n%s" "$line3"
[ -n "$line4" ] && printf "\n%s" "$line4"

# ccdash capture — only on machines where ccdash has run
# The desktop bridge mod sets STATUSLINE_BRIDGE: its input is rebuilt, not the real payload.
if [ -d "$HOME/.local/share/ccdash" ] && [ -z "$STATUSLINE_BRIDGE" ]; then
  printf '%s\n' "$input" >> "$HOME/.local/share/ccdash/statusline.jsonl"
fi
