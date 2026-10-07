-- Java on top of LazyVim's lang.java extra (nvim-jdtls).
--
-- Two JDKs are in play: jdtls itself needs 21+ to run, while code is checked
-- against TARGET_JAVA — the JDK the ECE 573 autograder compiles with (the
-- ubuntu-24.04 runner's default). Using a newer language feature then shows
-- up as an editor error instead of a failed submission.
local TARGET_JAVA = 17

-- Installed JDKs as { [major] = java_home }, read from each JDK's `release`
-- file. Not `java_home -v N`: it silently returns the newest JDK when N is
-- missing.
local function installed_jdks()
  local jdks = {}
  for _, release in ipairs(vim.fn.glob("/Library/Java/JavaVirtualMachines/*/Contents/Home/release", false, true)) do
    for line in io.lines(release) do
      local version = line:match('^JAVA_VERSION="([%d%.]+)')
      if version then
        -- 1.8.0_x -> 8, 17.0.20 -> 17
        local major = tonumber(version:match("^1%.(%d+)") or version:match("^(%d+)"))
        jdks[major] = vim.fs.dirname(release)
        break
      end
    end
  end
  return jdks
end

return {
  {
    "mfussenegger/nvim-jdtls",
    optional = true,
    opts = function(_, opts)
      local jdks = installed_jdks()
      local newest = math.max(0, unpack(vim.tbl_keys(jdks)))

      -- default = true decides which JDK a project without pom.xml/gradle
      -- (like the course repos) is compiled against
      local runtimes = {}
      for major, home in pairs(jdks) do
        table.insert(runtimes, {
          name = major == 8 and "JavaSE-1.8" or ("JavaSE-" .. major),
          path = home,
          default = major == TARGET_JAVA,
        })
      end
      opts.settings = vim.tbl_deep_extend("force", opts.settings or {}, {
        java = { configuration = { runtimes = runtimes } },
      })

      local parent = opts.jdtls
      opts.jdtls = function(config)
        if type(parent) == "function" then
          config = parent(config) or config
        elseif parent then
          config = vim.tbl_deep_extend("force", config, parent)
        end

        -- the mason jdtls wrapper launches with $JAVA_HOME, which the shell
        -- may point at TARGET_JAVA
        if newest >= 21 then
          config.cmd_env = vim.tbl_extend("force", config.cmd_env or {}, { JAVA_HOME = jdks[newest] })
        end

        -- ANTLR course layout: hand-written sources in java/, generated
        -- lexer/parser in build/ (both default package, built by a Makefile).
        -- Copy settings rather than mutate: the table is shared by every root.
        local root = config.root_dir
        if root and #vim.fn.glob(root .. "/*.g4", false, true) > 0 then
          config.settings = vim.tbl_deep_extend("force", {}, config.settings or {}, {
            java = { project = { sourcePaths = { "java", "build" } } },
          })
        end
        return config
      end
    end,
  },
}
