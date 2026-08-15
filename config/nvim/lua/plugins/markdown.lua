return {
  -- silence markdownlint (MD013 line-length, MD022/MD032 blank-line rules, etc.)
  {
    "mfussenegger/nvim-lint",
    optional = true,
    opts = function(_, opts)
      opts.linters_by_ft = opts.linters_by_ft or {}
      opts.linters_by_ft.markdown = {}
    end,
  },
  -- swap LazyVim's render-markdown for the fancier, Obsidian-like markview
  { "MeanderingProgrammer/render-markdown.nvim", enabled = false },
  -- format markdown with hard-wrapped prose at 80 cols (<leader>cf);
  -- narrow windows then never soft-wrap, which kills the conceal-gap artifacts
  {
    "stevearc/conform.nvim",
    optional = true,
    opts = function(_, opts)
      opts.formatters = opts.formatters or {}
      opts.formatters.prettier_md = {
        command = "prettier",
        args = {
          "--stdin-filepath", "$FILENAME",
          "--parser", "markdown",
          "--prose-wrap", "always",
          "--print-width", "80",
        },
        stdin = true,
      }
      opts.formatters_by_ft = opts.formatters_by_ft or {}
      opts.formatters_by_ft.markdown = { "prettier_md" }
    end,
  },
  {
    "OXY2DEV/markview.nvim",
    lazy = false, -- author recommends loading at startup, it lazy-loads internally
    -- wrap is disabled for markdown in config/autocmds.lua — markview only
    -- fully renders tables when their rows don't soft-wrap
    --
    -- local patch: stock markview stops rendering a table the moment the window
    -- is horizontally scrolled past its first column (renderers/markdown.lua,
    -- the left_col early-return). On nvim 0.12 the inline/conceal decorations
    -- shift correctly with leftcol (only the top border drifts 1-2 cols), so we
    -- disable that bail-out. build re-applies the patch after plugin updates.
    build = function(plugin)
      local path = plugin.dir .. "/lua/markview/renderers/markdown.lua"
      local f = io.open(path, "r")
      if not f then return end
      local src = f:read("*a")
      f:close()
      local needle = 'if type(left_col) == "number" and left_col > range.col_start then'
      local patched = 'if false and type(left_col) == "number" and left_col > range.col_start then'
      local s, e = src:find(needle, 1, true)
      if s then
        src = src:sub(1, s - 1) .. patched .. src:sub(e + 1)
        local w = assert(io.open(path, "w"))
        w:write(src)
        w:close()
      elseif not src:find(patched, 1, true) then
        vim.notify(
          "markview hscroll patch: left_col bail-out not found after update — wide tables will collapse when scrolled",
          vim.log.levels.WARN
        )
      end
    end,
    opts = {
      preview = {
        icon_provider = "mini", -- LazyVim ships mini.icons
      },
      latex = { enable = false }, -- snacks.image typesets math as real images instead
    },
  },
  -- inline images in the terminal: mermaid diagrams, LaTeX math, and image links
  -- requires a kitty-graphics terminal (Ghostty) + magick/tectonic/gs/mmdc
  {
    "folke/snacks.nvim",
    opts = {
      image = {
        enabled = true,
        doc = { inline = true, float = true },
        math = { enabled = true },
        convert = {
          -- TokyoNight-styled mermaid: thicker strokes, theme colors, MesloLGS font
          mermaid = function()
            return {
              "-i", "{src}",
              "-o", "{file}",
              "-b", "transparent",
              "-c", vim.fn.expand("~/.config/mermaid/tokyonight.json"),
              "-s", "{scale}",
            }
          end,
        },
      },
    },
  },
  {
    "ellisonleao/glow.nvim",
    cmd = "Glow",
    opts = {
      border = "rounded",
      width_ratio = 0.85,
      height_ratio = 0.85,
    },
    keys = {
      { "<leader>cg", "<cmd>Glow<cr>", desc = "Glow preview", ft = "markdown" },
    },
  },
}
