# Image slots

Six placeholders in the top-level `README.md`, each marked with a comment banner
like `📸 IMAGE SLOT 3 of 6`. Search the README for `IMAGE SLOT` to find them.

To fill one: drop the file in this directory, then replace that entire comment
block with the single markdown line the banner gives you.

| # | File | Type | What to capture | Priority |
|---|---|---|---|---|
| 1 | `hero.png` | PNG | Full Ghostty window. tmux status bar visible, Neovim open on a markdown file rendering a mermaid diagram inline. ~1600px wide. | **Highest** — it's above the fold |
| 2 | `inline-images.gif` | GIF | A mermaid code block in Neovim rendering into a real diagram. 10–15s loop. | **Highest** — the headline feature |
| 3 | `fzf-tab.gif` | GIF | `cd ` + Tab, scrolling directories with the eza preview updating live; then `nvim ` + Tab for the bat file preview. ~10s. | High |
| 4 | `tmux-popups.gif` | GIF | `prefix+g` floats lazygit over a working layout, close it, `prefix+s` fuzzy-jumps to another session. ~12s. | High |
| 5 | `nvim-markdown.png` | PNG | Markdown file with headings, a wide table, a code block and a task list, rendered by markview.nvim. | Medium |
| 6 | `claude-code.png` | PNG | `prefix+a` splitting Claude Code beside Neovim, custom statusline visible. | Medium |

## Capture tips

- **Recording GIFs:** [vhs](https://github.com/charmbracelet/vhs) produces clean,
  scriptable, reproducible terminal GIFs — better than screen-recording, and the
  `.tape` script can live in this directory so captures are repeatable after a
  config change. `brew install vhs`.
- **Keep them small.** Under ~3MB each; GitHub is slow to load big GIFs and many
  readers bail before the loop starts. Trim aggressively — 10 seconds is plenty.
- **Sizing.** Around 1200–1600px wide renders sharply on GitHub without forcing
  horizontal scroll on the README.
- **Before capturing**, clear the scrollback and use a directory whose name you're
  happy to publish. Screenshots leak paths, branch names and hostnames more often
  than people expect.
- **Dark background** matches the badges and the config's own palette.
