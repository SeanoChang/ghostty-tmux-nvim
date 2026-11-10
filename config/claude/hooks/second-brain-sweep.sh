#!/bin/bash
# On-demand sweep over the questions that second-brain-log-prompt.sh recorded.
# Read-only: it prints candidates for a vault capture and changes nothing.
# The second-brain-obsidian skill says what to do with the list.
#
#   second-brain-sweep.sh [--days N] [--all]
#
#   --days N   look back N days (default 7; the log keeps 30)
#   --all      also list prompts that carry no concept phrase
#
# Always left out: prompts under 15 characters, slash commands, sessions in a
# temp folder, and repeats of one prompt. The first line gives the count shown
# and the count kept, so a filtered list never reads as the whole log.
usage() { sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; }

days=7
all=0
while [ $# -gt 0 ]; do
  case "$1" in
    --days) days="${2-}"; shift; [ $# -gt 0 ] && shift ;;
    --all) all=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "second-brain-sweep: unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$days" in
  '' | *[!0-9]*) echo "second-brain-sweep: --days needs a whole number" >&2; exit 2 ;;
esac

dir="${SB_QUESTION_LOG_DIR:-$HOME/.claude/second-brain/questions}"
# BSD date (macOS) first, GNU date second.
cutoff=$(date -u -v-"${days}"d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null) ||
  cutoff=$(date -u -d "${days} days ago" +%Y-%m-%dT%H:%M:%SZ) || exit 2

# A prompt that asks about a concept, in the words Sean uses.
concept='\b(what is|what'"'"'s|what are|how does|how do|how is|explain|help me understand|dig deeper|difference between|teach me|walk me through|why does|why is|why do)\b'

{
  [ -d "$dir" ] && find "$dir" -name '*.jsonl' -type f -exec cat {} +
} 2>/dev/null |
  jq -R -r -n --arg cutoff "$cutoff" --arg days "$days" --arg concept "$concept" --argjson all "$all" '
    [ inputs
      | fromjson?
      | select(type == "object")
      # A field of the wrong type must drop its own line, not stop the sweep.
      | select((.ts | type) == "string" and (.prompt | type) == "string")
      | .cwd = (if (.cwd | type) == "string" then .cwd else "" end)
      | select(.ts >= $cutoff)
      # Only the first 400 characters are read: a pasted document can be megabytes,
      # and a question states itself early.
      | .prompt = (.prompt[0:400] | gsub("\\s+"; " ") | sub("^ "; "") | sub(" $"; ""))
      | select((.prompt | length) >= 15)
      | select(.prompt | startswith("/") | not)
      | select(.cwd | test("^(/private)?/tmp(/|$)|^(/private)?/var/folders/") | not)
    ]
    | unique_by(.prompt)
    | sort_by(.ts)
    | . as $kept
    | ($kept | map(select($all == 1 or (.prompt | test($concept; "i"))))) as $shown
    | "Logged questions, last \($days) days: \($shown | length) shown of \($kept | length)"
      + (if $all == 1 then "" else " (concept-phrased only; --all lists the rest)" end),
      ($shown[] | "\(.ts[0:10])  \(.cwd | split("/") | last // "-")  \(.prompt[0:200])")
  '
