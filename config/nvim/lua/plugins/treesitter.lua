return {
  {
    "nvim-treesitter/nvim-treesitter",
    opts = {
      ensure_installed = {
        "astro",
        "bash",
        "c",
        "css",
        "diff",
        "gitignore",
        "go",
        "html",
        "javascript",
        "jsdoc",
        "json",
        "jsonc",
        "latex",
        "lua",
        "luadoc",
        "luap",
        "markdown",
        "markdown_inline",
        "python",
        "query",
        "regex",
        "rust",
        "sql",
        "svelte",
        "toml",
        "tsx",
        "typescript",
        "vim",
        "vimdoc",
        "yaml",
      },
    },
    init = function()
      -- MDX
      vim.filetype.add({ extension = { mdx = "mdx" } })
      vim.treesitter.language.register("markdown", "mdx")
    end,
  },
}
