# Images

Every image in the top-level `README.md`:

| File | What it shows |
|---|---|
| `hero.png` | Ghostty with tmux: Neovim renders a design doc (inline mermaid, table, task list) beside a shell pane |
| `inline-images.gif` | A mermaid block gains a node, and the diagram redraws as the line is typed |
| `fzf-tab.gif` | `cd ` + Tab: a fuzzy list of folders, with the eza preview following the selection |
| `tmux-popups.gif` | `prefix+g` floats lazygit over a layout; `prefix+s` opens the session picker and switches session |
| `nvim-markdown.png` | markview.nvim rendering headings, inline code, code blocks and a table of contents |
| `agents-pane.png` | Claude Code with the agent-tree pane (fish theme) and the five-line status line |
| `brief-pane.png` | Claude Code with the Brief pane showing a plan with open decisions |

## How they were made

The shots are of a real Ghostty window, captured with `screencapture -l`. A
private tmux server drove it (its own `TMUX_TMPDIR`, an empty shell history and
a demo-only zoxide database), so no real paths, sessions or history appear.
The project is a throwaway `~/demo/orderbook` repo with a demo git author.
GIFs are built from one frame per step with ImageMagick:

```sh
magick -delay 150 f01.png -delay 60 f02.png … -resize 1200x -colors 128 \
  -layers Optimize -loop 0 out.gif
```

## Before adding one

- Use a folder name you are happy to publish. Screenshots leak paths, branch
  names, usernames and hostnames more often than people expect.
- `eza -l` prints the owner column, so it shows your username.
- Claude Code may print a settings warning at startup that names a private
  path. Make sure it is off screen.
- Keep each file under about 3 MB and around 1200–1400 px wide.
