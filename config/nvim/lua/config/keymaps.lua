-- ~/.config/nvim/lua/config/keymaps.lua

local map = vim.keymap.set

-- ============================================================================
-- LINE MOVEMENT (Option/Alt + j/k or up/down)
-- ============================================================================
-- Normal mode
map("n", "<A-j>", ":m .+1<CR>==", { desc = "Move line down" })
map("n", "<A-k>", ":m .-2<CR>==", { desc = "Move line up" })
map("n", "<A-Down>", ":m .+1<CR>==", { desc = "Move line down" })
map("n", "<A-Up>", ":m .-2<CR>==", { desc = "Move line up" })

-- Visual mode
map("v", "<A-j>", ":m '>+1<CR>gv=gv", { desc = "Move line down" })
map("v", "<A-k>", ":m '<-2<CR>gv=gv", { desc = "Move line up" })
map("v", "<A-Down>", ":m '>+1<CR>gv=gv", { desc = "Move line down" })
map("v", "<A-Up>", ":m '<-2<CR>gv=gv", { desc = "Move line up" })

-- Insert mode
map("i", "<A-j>", "<Esc>:m .+1<CR>==gi", { desc = "Move line down" })
map("i", "<A-k>", "<Esc>:m .-2<CR>==gi", { desc = "Move line up" })

-- ============================================================================
-- DUPLICATE LINES (Option/Alt + Shift + j/k)
-- ============================================================================
map("n", "<A-S-j>", ":t.<CR>==", { desc = "Duplicate line down" })
map("n", "<A-S-k>", ":t.-1<CR>==", { desc = "Duplicate line up" })
map("v", "<A-S-j>", ":t'><CR>gv", { desc = "Duplicate selection down" })
map("v", "<A-S-k>", ":t'<-1<CR>gv", { desc = "Duplicate selection up" })

-- ============================================================================
-- DELETION (Option/Cmd + Delete/Backspace)
-- ============================================================================
-- Option + Delete: delete word forward
map("i", "<A-BS>", "<C-w>", { desc = "Delete word backward" })
map("i", "<A-Del>", "<C-o>dw", { desc = "Delete word forward" })

-- Cmd + Delete: delete to start of line
map("i", "<D-BS>", "<C-u>", { desc = "Delete to line start" })
map("n", "<D-BS>", "d0", { desc = "Delete to line start" })

-- Cmd + Delete (forward): delete to end of line
map("i", "<D-Del>", "<C-o>D", { desc = "Delete to line end" })
map("n", "<D-Del>", "D", { desc = "Delete to line end" })

-- ============================================================================
-- SAVE & QUIT (Cmd + s, Cmd + w, Cmd + q)
-- ============================================================================
map({ "n", "i", "v" }, "<D-s>", "<Esc>:w<CR>", { desc = "Save file" })
map({ "n", "i", "v" }, "<D-w>", "<Esc>:bd<CR>", { desc = "Close buffer" })
map({ "n", "i", "v" }, "<D-q>", "<Esc>:qa<CR>", { desc = "Quit all" })

-- ============================================================================
-- COMMENTING (Cmd + /)
-- Requires: 'numToStr/Comment.nvim' or 'echasnovski/mini.comment'
-- ============================================================================
map("n", "<D-/>", "gcc", { desc = "Toggle comment", remap = true })
map("v", "<D-/>", "gc", { desc = "Toggle comment", remap = true })
map("i", "<D-/>", "<Esc>gccgi", { desc = "Toggle comment", remap = true })

-- ============================================================================
-- NAVIGATION (Cmd + arrows for home/end)
-- ============================================================================
-- Cmd + Left/Right: beginning/end of line
map({ "n", "v", "i" }, "<D-Left>", "<Home>", { desc = "Go to line start" })
map({ "n", "v", "i" }, "<D-Right>", "<End>", { desc = "Go to line end" })

-- Cmd + Up/Down: top/bottom of file
map({ "n", "v", "i" }, "<D-Up>", "<Esc>gg", { desc = "Go to top" })
map({ "n", "v", "i" }, "<D-Down>", "<Esc>G", { desc = "Go to bottom" })

-- Option + Left/Right: word navigation
map({ "n", "v" }, "<A-Left>", "b", { desc = "Previous word" })
map({ "n", "v" }, "<A-Right>", "w", { desc = "Next word" })
map("i", "<A-Left>", "<C-o>b", { desc = "Previous word" })
map("i", "<A-Right>", "<C-o>w", { desc = "Next word" })

-- ============================================================================
-- SEARCH & REPLACE (Cmd + f, Cmd + h)
-- ============================================================================
map("n", "<D-f>", "/", { desc = "Search" })
map("v", "<D-f>", 'y/<C-r>"<CR>', { desc = "Search selection" })
map("n", "<D-h>", ":%s/", { desc = "Replace in file" })

-- ============================================================================
-- SELECT ALL (Cmd + a)
-- ============================================================================
map({ "n", "v" }, "<D-a>", "ggVG", { desc = "Select all" })
map("i", "<D-a>", "<Esc>ggVG", { desc = "Select all" })

-- ============================================================================
-- UNDO/REDO (Cmd + z, Cmd + Shift + z)
-- ============================================================================
map({ "n", "i" }, "<D-z>", "<Esc>u", { desc = "Undo" })
map({ "n", "i" }, "<D-S-z>", "<Esc><C-r>", { desc = "Redo" })

-- ============================================================================
-- LINE OPERATIONS
-- ============================================================================
-- Cmd + Shift + k: delete line
map("n", "<D-S-k>", "dd", { desc = "Delete line" })
map("i", "<D-S-k>", "<Esc>ddi", { desc = "Delete line" })

-- Cmd + Enter: insert line below
map({ "n", "i" }, "<D-CR>", "<Esc>o", { desc = "Insert line below" })

-- Cmd + Shift + Enter: insert line above
map({ "n", "i" }, "<D-S-CR>", "<Esc>O", { desc = "Insert line above" })

-- ============================================================================
-- TAB NAVIGATION (Cmd + number, Cmd + Option + Left/Right)
-- ============================================================================
map("n", "<D-1>", "1gt", { desc = "Go to tab 1" })
map("n", "<D-2>", "2gt", { desc = "Go to tab 2" })
map("n", "<D-3>", "3gt", { desc = "Go to tab 3" })
map("n", "<D-4>", "4gt", { desc = "Go to tab 4" })
map("n", "<D-5>", "5gt", { desc = "Go to tab 5" })

map("n", "<D-A-Left>", "gT", { desc = "Previous tab" })
map("n", "<D-A-Right>", "gt", { desc = "Next tab" })

-- ============================================================================
-- SPLIT NAVIGATION (Ctrl + h/j/k/l)
-- ============================================================================
map("n", "<C-h>", "<C-w>h", { desc = "Go to left split" })
map("n", "<C-j>", "<C-w>j", { desc = "Go to bottom split" })
map("n", "<C-k>", "<C-w>k", { desc = "Go to top split" })
map("n", "<C-l>", "<C-w>l", { desc = "Go to right split" })

-- ============================================================================
-- INDENT (Tab/Shift+Tab in visual mode, stay in visual)
-- ============================================================================
map("v", "<Tab>", ">gv", { desc = "Indent" })
map("v", "<S-Tab>", "<gv", { desc = "Unindent" })

-- ============================================================================
-- BETTER ESCAPE
-- ============================================================================
map("i", "jk", "<Esc>", { desc = "Exit insert mode" })
map("i", "kj", "<Esc>", { desc = "Exit insert mode" })

-- ============================================================================
-- QUICKFIX / CODE ACTIONS (if using LSP)
-- ============================================================================
map("n", "<D-.>", vim.lsp.buf.code_action, { desc = "Code actions" })
map("n", "gd", vim.lsp.buf.definition, { desc = "Go to definition" })
map("n", "gr", vim.lsp.buf.references, { desc = "Go to references" })
map("n", "K", vim.lsp.buf.hover, { desc = "Hover documentation" })
map("n", "<D-k>", vim.lsp.buf.signature_help, { desc = "Signature help" })

-- ============================================================================
-- FORMAT DOCUMENT (Cmd + Shift + f)
-- ============================================================================
map("n", "<D-S-f>", vim.lsp.buf.format, { desc = "Format document" })
map("v", "<D-S-f>", vim.lsp.buf.format, { desc = "Format selection" })

-- ============================================================================
-- WINDOW SPLITS
-- ============================================================================
-- Split vertically (right)
vim.keymap.set("n", "<leader>sv", "<cmd>vsplit<cr>", { desc = "Split vertical (right)" })
vim.keymap.set("n", "<leader>|", "<cmd>vsplit<cr>", { desc = "Split vertical" })

-- Split horizontally (bottom)
vim.keymap.set("n", "<leader>sh", "<cmd>split<cr>", { desc = "Split horizontal (bottom)" })
vim.keymap.set("n", "<leader>-", "<cmd>split<cr>", { desc = "Split horizontal" })

-- Close split
vim.keymap.set("n", "<leader>sx", "<cmd>close<cr>", { desc = "Close split" })

-- Navigate between splits (if not already added)
vim.keymap.set("n", "<C-h>", "<C-w>h", { desc = "Go to left split" })
vim.keymap.set("n", "<C-j>", "<C-w>j", { desc = "Go to bottom split" })
vim.keymap.set("n", "<C-k>", "<C-w>k", { desc = "Go to top split" })
vim.keymap.set("n", "<C-l>", "<C-w>l", { desc = "Go to right split" })

-- Resize splits
vim.keymap.set("n", "<C-Up>", "<cmd>resize +2<cr>", { desc = "Increase height" })
vim.keymap.set("n", "<C-Down>", "<cmd>resize -2<cr>", { desc = "Decrease height" })
vim.keymap.set("n", "<C-Left>", "<cmd>vertical resize -2<cr>", { desc = "Decrease width" })
vim.keymap.set("n", "<C-Right>", "<cmd>vertical resize +2<cr>", { desc = "Increase width" })

-- Equal splits
vim.keymap.set("n", "<leader>s=", "<C-w>=", { desc = "Equal splits" })

-- ============================================================================
-- TERMINAL MODE MAPPINGS
-- ============================================================================
-- Shift+Enter: new line in terminal without executing
map("t", "<S-CR>", "<C-\\><C-n>A<CR>i", { desc = "New line in terminal" })

-- Optional: Easier escape from terminal mode
map("t", "<Esc>", "<C-\\><C-n>", { desc = "Exit terminal mode" })
