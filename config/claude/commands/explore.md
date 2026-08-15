# Explore Codebase

Quickly orient in the current project using the codebase map.

## Instructions

1. **Read `.claude/codebase-map.md`** in the project root. If it doesn't exist, tell the user to run `/map` first and stop.

2. **Present a summary** to the user:
   - Stack and framework
   - Number of key modules
   - Entry points with one-line descriptions

3. **If the user provided a query** (e.g., `/explore auth` or `/explore how does routing work`):
   - Search the codebase map for relevant modules, files, and entry points
   - Read the top 3-5 most relevant files identified from the map
   - Give a concise explanation of how that area works, referencing specific files with `file_path:line_number` format
   - Show the call chain or data flow if applicable

4. **If no query was provided**, show the full directory overview from the map and ask what area the user wants to dive into.

5. Always reference file paths from the map so the user can navigate directly. Keep answers short — point to code, don't re-explain it.

$ARGUMENTS
