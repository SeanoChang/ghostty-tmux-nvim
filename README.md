# dotfiles

macOS terminal setup: **Ghostty · tmux · Neovim (LazyVim) · zsh · Claude Code**.

Everything is symlinked from this repo into `$HOME` by `install.sh`, so editing a
config in place edits the repo. No credentials live here — see
[Authentication](#authentication) for what you still have to log into by hand.

---

## Quickstart

```sh
git clone https://github.com/<you>/dotfiles ~/dev/dotfiles
cd ~/dev/dotfiles

./install.sh --dry-run     # see exactly what would change
brew bundle                # install the toolchain (~45 formulae, 7 casks)
./install.sh               # symlink the configs
exec zsh
```

Then the bootstraps `brew bundle` can't do — three git clones and one npm global:

```sh
git clone https://github.com/tmux-plugins/tpm ~/.config/tmux/plugins/tpm
git clone https://github.com/Aloxaf/fzf-tab ~/.zsh/fzf-tab
git clone https://github.com/ohmyzsh/ohmyzsh ~/.oh-my-zsh
npm install -g @mermaid-js/mermaid-cli      # `mmdc`, for nvim diagram rendering

tmux                       # then: prefix (C-a) + I   → installs tmux plugins
nvim                       # lazy.nvim bootstraps itself on first launch
```

## What's in here

| Path | Installs to | What it is |
|---|---|---|
| `config/ghostty/` | `~/.config/ghostty/config` | Ghostty terminal — iTerm2-derived palette, MesloLGS NF, splits/tabs bound to macOS muscle memory |
| `config/tmux/` | `~/.config/tmux/tmux.conf` | tmux 3.5+ — `C-a` prefix, popups, Claude Code bindings, TokyoNight Moon status bar |
| `config/nvim/` | `~/.config/nvim` | LazyVim with 21 extras, 51 plugins, a full macOS keybinding layer, and inline image/mermaid rendering |
| `config/zsh/` | `~/.zshrc` etc. | oh-my-zsh + powerlevel10k, fzf-tab, zoxide, eza aliases |
| `config/git/` | `~/.gitconfig`, `~/.config/git/ignore` | Identity is a **placeholder** — you fill it in |
| `config/claude/` | `~/.claude/` | Claude Code global rules, settings, statusline, custom commands and skill |
| `config/mermaid/` | `~/.config/mermaid/` | TokyoNight mermaid theme, used by Neovim's inline diagram rendering |
| `Brewfile` | — | The toolchain every config above depends on |

## How install.sh works

It reads `manifest.txt` — a three-column list of `mode`, `source`, `destination` —
and for each entry:

- **`link`** symlinks the destination at the repo file. Edits flow back to the repo.
- **`copy`** copies the file, **only if the destination doesn't exist**. Used for
  `~/.gitconfig`, which must hold your real name and email — if it were a symlink,
  `git config --global user.email …` would write your address into a tracked file
  in a public repo.
- A `.tmpl` source is rendered first: `__HOME__` becomes your actual `$HOME`.
  Rendered link-mode output lands in `~/.dotfiles-rendered/`, outside the repo.

Anything already occupying a destination is **moved** to
`~/.dotfiles-backup/<timestamp>/`, preserving its path. Nothing is ever deleted.
Re-running is safe — correct symlinks are left alone.

```
./install.sh --dry-run       print the plan, change nothing
./install.sh --only nvim     install one group
./install.sh --help
```

Groups are the path segment after `config/`: `ghostty`, `tmux`, `nvim`, `zsh`,
`git`, `claude`, `mermaid`.

## Authentication

**No tokens, keys, or session state are in this repo.** After installing, log in
to whatever you actually use:

| Tool | Command | Notes |
|---|---|---|
| GitHub CLI | `gh auth login` | |
| Claude Code | `claude` | Browser OAuth on first run. MCP connectors (Notion, Slack, Figma, Gmail…) are authorised separately from inside the TUI with `/mcp`. |
| AWS | `aws configure` | Or drop a profile into `~/.aws/config` |
| Google Cloud | `gcloud auth login` && `gcloud auth application-default login` | |
| Fly.io | `flyctl auth login` | |
| Docker Hub | `docker login` | |
| Raycast | in-app | Stores a token at `~/.config/raycast/config.json` — never commit that file |

`~/.gitconfig` is created from a template with `YOUR_NAME` / `YOUR_EMAIL`
placeholders. Set them:

```sh
git config --global user.name  "Your Name"
git config --global user.email "you@example.com"
```

## Other AI CLIs

Configs for these are **deliberately not shipped** — they carry per-machine trust
lists and auth state. Noted here so the setup is reproducible by hand:

- **Codex** — `~/.codex/config.toml`. Worth setting `model_reasoning_effort` and
  `personality`. Its `AGENTS.md` is symlinked to `~/.claude/CLAUDE.md` so both
  agents read the same rules:
  `ln -s ~/.claude/CLAUDE.md ~/.codex/AGENTS.md`
- **opencode** — `~/.config/opencode/`. Same `AGENTS.md` symlink trick.
- **Gemini / Antigravity** — `~/.gemini/settings.json`. OAuth personal auth.
- **GitHub Copilot** — used inside Neovim via the LazyVim `ai.copilot` extra and
  `blink-copilot`. Run `:Copilot auth` once.

## Notes per tool

### tmux
Prefix is **`C-a`**, not `C-b`. Popups: `prefix+g` lazygit, `prefix+f` yazi,
`prefix+t` scratch session, `prefix+s` sesh session picker. Claude Code:
`prefix+a` side pane, `prefix+A` own window, `prefix+C` throwaway popup.
`C-hjkl` moves between tmux panes and Neovim splits interchangeably — that works
because Neovim maps the same keys to `<C-w>hjkl`; add
[vim-tmux-navigator](https://github.com/christoomey/vim-tmux-navigator) if you
also want to step *out* of Neovim's edge split into a tmux pane.

### nvim
LazyVim base. `lua/config/keymaps.lua` layers macOS/VSCode bindings over vim
(`Cmd+s`, `Cmd+/`, `Alt+j/k` to move lines, `jk` to escape).
`lua/plugins/markdown.lua` swaps LazyVim's markdown renderer for
[markview.nvim](https://github.com/OXY2DEV/markview.nvim) and carries a `build`
hook that **patches markview's source** on every update — it disables the
`left_col` early-return so wide tables keep rendering when scrolled horizontally.
If markview changes upstream, the hook warns instead of failing silently.

Inline images (mermaid diagrams, LaTeX, image links) need a kitty-graphics
terminal — Ghostty qualifies — plus `imagemagick`, `ghostscript` and `tectonic`,
which the Brewfile installs. `mermaid-cli` is **not** a formula; it's an npm
global, and without it mermaid blocks render as plain code:

```sh
npm install -g @mermaid-js/mermaid-cli   # provides `mmdc`
```

### zsh
Instant-prompt powerlevel10k. `fzf-tab` gives fuzzy completion with `eza`
previews for directories and `bat` previews for files. `chpwd` lists the
directory on every `cd`. `conda` is a lazy shim that replaces itself on first
call, so it costs nothing at startup.

fzf-tab is cloned separately (it isn't a formula):

```sh
git clone https://github.com/Aloxaf/fzf-tab ~/.zsh/fzf-tab
```

### Claude Code
`CLAUDE.md` holds global working rules — reproduce bugs before fixing, show
evidence before claiming success, never run mutating infra commands, never print
secrets. `settings.json` enables 16 official plugins and a custom statusline
(`statusline-command.sh`) showing model, context usage, and rate-limit windows.
`commands/` has `/map` and `/explore`; `skills/` has `writing-markdown-docs`.

## Uninstall

`install.sh` only creates symlinks and one copied file, so removing them is
enough. Your originals are in `~/.dotfiles-backup/<timestamp>/`.

## License

Config files are MIT-licensed where they're mine. `config/nvim/LICENSE` is the
upstream LazyVim starter license; `config/zsh/p10k.zsh` is generated by
powerlevel10k's own configuration wizard.
