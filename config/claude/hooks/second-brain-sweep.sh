#!/bin/bash
# On-demand sweep over the questions that second-brain-log-prompt.sh recorded.
# Read-only: it prints candidates for a vault capture and changes nothing.
# The second-brain-obsidian skill says what to do with the list.
#
#   second-brain-sweep.sh [--days N] [--all]
#
#   --days N   look back N days (default 7, at most 36500; the log keeps 30)
#   --all      also list prompts that carry no concept phrase
#
# Always left out: prompts under 15 characters, slash commands, sessions in a
# temp folder, and repeats of one prompt. The first line gives the count shown
# and the count kept, so a filtered list never reads as the whole log.
#
# Every log line has one of three ends: it is kept, a rule above leaves it out,
# or it cannot be read (not JSON, a field of the wrong type, a timestamp that
# is not a date) and the first line counts it. A folder or file that cannot be
# read stops the sweep with exit 2: a short list must never pass for the log.
usage() { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; }

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
# Drop leading zeros as text, then test the length before the value: a number
# past the shell's range would wrap.
days="${days#"${days%%[!0]*}"}"
days="${days:-0}"
if [ "${#days}" -gt 5 ] || [ "$days" -gt 36500 ]; then
  echo "second-brain-sweep: --days is at most 36500" >&2; exit 2
fi

dir="${SB_QUESTION_LOG_DIR:-$HOME/.claude/second-brain/questions}"
# No log folder yet is an empty log. A path that is something else is a mistake.
if { [ -e "$dir" ] || [ -L "$dir" ]; } && [ ! -d "$dir" ]; then
  echo "second-brain-sweep: $dir is not a folder; nothing reported" >&2; exit 2
fi
# BSD date (macOS) first, GNU date second.
cutoff=$(date -u -v-"${days}"d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null) ||
  cutoff=$(date -u -d "${days} days ago" +%Y-%m-%dT%H:%M:%SZ) || exit 2

# A prompt that asks about a concept, in the words Sean uses.
concept='\b(what is|what'"'"'s|what are|how does|how do|how is|explain|help me understand|dig deeper|difference between|teach me|walk me through|why does|why is|why do)\b'

# Every log line, each file ended by a newline of its own. Without that, a
# file whose last line has no newline would run into the next file's first
# line, and both would be lost. -H: a log folder that is a symlink is read.
# Any file or folder that cannot be read makes this fail.
read_logs() {
  [ -d "$dir" ] || return 0
  find -H "$dir" -name '*.jsonl' -type f -exec sh -c '
    rc=0
    for f do cat "$f" || rc=1; echo; done
    exit "$rc"' sh {} +
}

set -o pipefail
out=$(
  read_logs |
    jq -R -r -n --arg cutoff "$cutoff" --arg days "$days" --arg concept "$concept" --argjson all "$all" '
    # One entry per line that is not blank: the row, or false when the line
    # cannot be read. A row older than the window gives no entry.
    [ inputs
      | select(test("\\S"))
      | (try fromjson catch null) as $o
      | if ($o | type) == "object"
           and ($o.prompt | type) == "string"
           and ($o.ts | type) == "string"
           and ($o.ts | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$"))
        then
          if $o.ts >= $cutoff then
            { ts: $o.ts,
              cwd: (if ($o.cwd | type) == "string" then $o.cwd else "" end),
              # Only the first 400 characters are read: a pasted document can
              # be megabytes, and a question states itself early.
              prompt: ($o.prompt[0:400] | gsub("\\s+"; " ") | sub("^ "; "") | sub(" $"; "")) }
          else empty end
        else false end
    ] as $lines
    | ($lines | map(select(. == false)) | length) as $bad
    | [ $lines[]
        | select(. != false)
        | select((.prompt | length) >= 15)
        # A slash command is one word after the slash. A prompt that starts
        # with a file path has a second slash in its first word and is kept.
        | select(.prompt | test("^/[^/\\s]+(\\s|$)") | not)
        | select(.cwd | test("^(/private)?/tmp(/|$)|^(/private)?/var/tmp(/|$)|^(/private)?/var/folders/") | not)
      ]
    | unique_by(.prompt)
    | sort_by(.ts)
    | . as $kept
    | ($kept | map(select($all == 1 or (.prompt | test($concept; "i"))))) as $shown
    | "Logged questions, last \($days) days: \($shown | length) shown of \($kept | length)"
      + (if $all == 1 then "" else " (concept-phrased only; --all lists the rest)" end)
      + (if $bad == 0 then "" else "; \($bad) unreadable line\(if $bad == 1 then "" else "s" end) skipped" end),
      ($shown[]
        | (.cwd | sub("/+$"; "") | split("/") | last // "") as $folder
        | "\(.ts[0:10])  \(if $folder == "" then "-" else $folder end)  \(.prompt[0:200])")
  '
) || {
  echo "second-brain-sweep: could not read all of $dir, or jq failed; nothing reported" >&2
  exit 2
}
printf '%s\n' "$out"
