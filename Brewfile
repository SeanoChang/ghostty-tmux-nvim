# Brewfile — install with `brew bundle` from the repo root.
#
# Hand-curated rather than `brew bundle dump`ed, because dump only emits
# installed-on-request formulae: zoxide is pulled in as someone else's
# dependency here, so a dumped Brewfile would omit it and ~/.zshrc's
# `eval "$(zoxide init zsh)"` would fail on a clean machine.
#
# Not installable from here — see README:
#   @mermaid-js/mermaid-cli   npm global, provides `mmdc` for nvim diagrams
#   Aloxaf/fzf-tab            git clone into ~/.zsh/fzf-tab
#   tmux-plugins/tpm          git clone into ~/.config/tmux/plugins/tpm

tap "joshmedeski/sesh"
tap "one2nc/cloudlens"

# ── terminal, shell, prompt ──────────────────────────────────────────────────
cask "ghostty"
brew "tmux"
brew "powerlevel10k"
brew "zsh-autosuggestions"
brew "zsh-syntax-highlighting"

# ── the CLI core the configs actually depend on ──────────────────────────────
brew "neovim"
brew "eza"                    # ls/ll/lt aliases + fzf-tab and chpwd previews
brew "bat"                    # fzf-tab file preview
brew "fd"
brew "ripgrep"
brew "fzf"
brew "zoxide"                 # `z`; NOT a leaf, must be listed explicitly
brew "yazi"                   # `y` wrapper + tmux prefix+f popup
brew "lazygit"                # tmux prefix+g popup
brew "joshmedeski/sesh/sesh"  # tmux prefix+s session picker
brew "jq"                     # required by the Claude Code statusline script
brew "gh"
brew "wget"
brew "aria2"
brew "figlet"

# ── markdown / diagram / image rendering (nvim snacks.image + markview) ──────
brew "imagemagick"            # `magick`
brew "ghostscript"            # `gs`
brew "tectonic"               # LaTeX math
brew "poppler"
brew "glow"                   # <leader>cg markdown preview
brew "d2"

# ── languages & toolchains ───────────────────────────────────────────────────
brew "go"
brew "node"
brew "node@22"
brew "python@3.11"
brew "uv"
brew "pipx"
brew "r"
brew "cargo-binstall"
brew "cmake"
brew "meson"
brew "tree-sitter-cli"
brew "cocoapods"
cask "miniconda"

# ── data ─────────────────────────────────────────────────────────────────────
brew "postgresql@16"
brew "duckdb"
brew "sqlc"

# ── cloud / infra ────────────────────────────────────────────────────────────
brew "awscli"
cask "google-cloud-sdk"
cask "gcloud-cli"
brew "cloud-sql-proxy"
brew "argocd"
brew "helmfile"
brew "minikube"
brew "flyctl"
brew "syft"
brew "vegeta"
brew "e1s"
brew "stu"
brew "one2nc/cloudlens/cloudlens"
cask "ngrok"

# ── git ──────────────────────────────────────────────────────────────────────
brew "git-lfs"

# ── AI CLIs ──────────────────────────────────────────────────────────────────
# Claude Code installs itself; these are the others.
cask "codex"
cask "antigravity-cli"

# ── misc / transitive-but-wanted ─────────────────────────────────────────────
brew "unbound"
brew "yt-dlp"
brew "sui"
brew "gtk4"
brew "gtk-mac-integration"
brew "gobject-introspection"
brew "json-glib"
brew "desktop-file-utils"
