-- Autocmds are automatically loaded on the VeryLazy event
-- Default autocmds that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/autocmds.lua
-- Add any additional autocmds here

-- Markdown: no soft-wrap. Prose is already hard-wrapped at 80 by prettier
-- (conform), so only wide tables exceed the window — with wrap off they stay
-- one screen line per row and markview can render the full table box instead
-- of its degraded partial mode. Overrides LazyVim's wrap_spell autocmd, which
-- runs first because this file is loaded after lazyvim.config.autocmds.
vim.api.nvim_create_autocmd("FileType", {
  group = vim.api.nvim_create_augroup("markdown_nowrap", { clear = true }),
  pattern = { "markdown" },
  callback = function()
    vim.opt_local.wrap = false
    -- only matter if wrap is ever toggled back on: break at words, keep indent
    vim.opt_local.linebreak = true
    vim.opt_local.breakindent = true
  end,
})
