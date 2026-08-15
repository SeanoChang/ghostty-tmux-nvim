#!/usr/bin/env bash
#
# install.sh — link this repo's configs into $HOME.
#
#   ./install.sh                 install everything
#   ./install.sh --dry-run       print what would happen, change nothing
#   ./install.sh --only nvim     install one group (see manifest.txt)
#
# Anything it would overwrite is moved to ~/.dotfiles-backup/<timestamp>/ first.
# Re-running is safe: already-correct symlinks are left alone.
#
# It never runs sudo, never touches the network, and never deletes anything —
# files in the way are moved, not removed.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$REPO/manifest.txt"
RENDER_DIR="$HOME/.dotfiles-rendered"
BACKUP_DIR="$HOME/.dotfiles-backup/$(date +%Y%m%d-%H%M%S)"

DRY_RUN=0
ONLY=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --only)    ONLY="${2:-}"; [ -n "$ONLY" ] || { echo "--only needs a group name" >&2; exit 2; }; shift 2 ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)         echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

# ── output helpers ───────────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_OK=""; C_WARN=""; C_DIM=""; C_OFF=""
fi

say()  { printf '  %s%-9s%s %s\n' "$C_OK"   "$1" "$C_OFF" "$2"; }
warn() { printf '  %s%-9s%s %s\n' "$C_WARN" "$1" "$C_OFF" "$2"; }
skip() { printf '  %s%-9s %s%s\n' "$C_DIM"  "$1" "$2" "$C_OFF"; }

run() { [ "$DRY_RUN" -eq 1 ] || "$@"; }

# Print a path with $HOME collapsed to ~
tilde() { printf '%s' "${1/#$HOME/\~}"; }

backed_up_anything=0

# Move whatever currently occupies $1 into the backup tree, preserving its
# path underneath. Files are moved, never deleted.
backup() {
  local dest="$1"
  local rel="${dest/#$HOME\//}"
  local target="$BACKUP_DIR/$rel"
  run mkdir -p "$(dirname "$target")"
  run mv "$dest" "$target"
  backed_up_anything=1
  warn "backed up" "$(tilde "$dest") → $(tilde "$target")"
}

# Render __HOME__ in a .tmpl file. Echoes the path to the rendered result.
render() {
  local src="$1" out="$2"
  run mkdir -p "$(dirname "$out")"
  if [ "$DRY_RUN" -eq 0 ]; then
    sed "s|__HOME__|$HOME|g" "$src" > "$out"
    [ -x "$src" ] && chmod +x "$out"
  fi
  printf '%s' "$out"
}

install_link() {
  local src="$1" dest="$2"

  # already pointing where we want it
  if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$src" ]; then
    skip "ok" "$(tilde "$dest")"
    return
  fi

  # something is in the way — a real file/dir, or a symlink elsewhere
  if [ -e "$dest" ] || [ -L "$dest" ]; then
    backup "$dest"
  fi

  run mkdir -p "$(dirname "$dest")"
  run ln -s "$src" "$dest"
  say "linked" "$(tilde "$dest")"
}

install_copy() {
  local src="$1" dest="$2"

  if [ -e "$dest" ]; then
    skip "exists" "$(tilde "$dest")  (left alone — edit it by hand)"
    return
  fi

  run mkdir -p "$(dirname "$dest")"
  run cp "$src" "$dest"
  say "created" "$(tilde "$dest")"
}

# ── main ─────────────────────────────────────────────────────────────────────
[ -f "$MANIFEST" ] || { echo "manifest not found: $MANIFEST" >&2; exit 1; }

echo
echo "dotfiles → $HOME"
[ "$DRY_RUN" -eq 1 ] && echo "${C_WARN}dry run — nothing will be changed${C_OFF}"
[ -n "$ONLY" ]       && echo "group filter: $ONLY"
echo

count=0
while read -r mode src dest; do
  # skip comments and blank lines
  case "${mode:-}" in ''|\#*) continue ;; esac
  [ -n "${src:-}" ] && [ -n "${dest:-}" ] || { echo "malformed line: $mode $src $dest" >&2; exit 1; }

  # group = path segment after config/
  group="${src#config/}"; group="${group%%/*}"
  [ -n "$ONLY" ] && [ "$ONLY" != "$group" ] && continue

  abs_src="$REPO/$src"
  abs_dest="${dest/#\~/$HOME}"

  [ -e "$abs_src" ] || { echo "missing source: $src" >&2; exit 1; }

  # render templates before doing anything with them
  if [ "${abs_src##*.}" = "tmpl" ]; then
    if [ "$mode" = "copy" ]; then
      # render straight to dest, but only when dest is absent
      if [ -e "$abs_dest" ]; then
        skip "exists" "$(tilde "$abs_dest")  (left alone — edit it by hand)"
        count=$((count + 1))
        continue
      fi
      run mkdir -p "$(dirname "$abs_dest")"
      render "$abs_src" "$abs_dest" >/dev/null
      say "created" "$(tilde "$abs_dest")"
      count=$((count + 1))
      continue
    fi
    rel_out="${src#config/}"; rel_out="${rel_out%.tmpl}"
    abs_src="$(render "$abs_src" "$RENDER_DIR/$rel_out")"
  fi

  case "$mode" in
    link) install_link "$abs_src" "$abs_dest" ;;
    copy) install_copy "$abs_src" "$abs_dest" ;;
    *)    echo "unknown mode '$mode' for $src" >&2; exit 1 ;;
  esac
  count=$((count + 1))
done < "$MANIFEST"

echo
echo "$count entries processed."
[ "$backed_up_anything" -eq 1 ] && echo "backups: $(tilde "$BACKUP_DIR")"

cat <<'EOF'

Next steps
  1. exec zsh                                  reload the shell
  2. git clone https://github.com/tmux-plugins/tpm ~/.config/tmux/plugins/tpm
     then inside tmux: prefix (C-a) + I        install tmux plugins
  3. nvim                                      lazy.nvim bootstraps on first run
  4. edit ~/.gitconfig                         set user.name and user.email
  5. see README.md § Authentication            everything that needs a login
EOF
echo
