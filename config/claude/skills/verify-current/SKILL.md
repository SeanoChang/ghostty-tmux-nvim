---
name: verify-current
description: Check the current state of anything fast-moving before stating it or writing it into code, config, or rules — model names and IDs, SDK and API surfaces, CLI flags and subcommands, library versions, prices, rate limits, benchmark scores, release dates, deprecations. Use whenever an answer, command, or config depends on such a name, even one you recognize. Recognizing a name is not knowing its current state.
---

# verify-current

Your training data has a cutoff, and these facts change after it. Check
before you state them, in this order, and stop at the first source that
answers the question.

## Source order

1. **The installed thing.** It is the truth for this machine.
   - `<tool> --version`, `<tool> <subcommand> --help`
   - The lockfile or package metadata (`uv.lock`, `package-lock.json`,
     `pip show`, `npm ls`)
   - Tool caches and config, such as `~/.codex/models_cache.json` for Codex
     model IDs and effort levels. Never print auth files or secrets.
2. **Official docs and changelogs** from the vendor.
3. **Independent measurements** (Artificial Analysis, Vals.ai, published
   benchmark repos) for model quality, speed, and price.
4. **Secondary sources** (blogs, roundups). Use only for what 1–3 don't cover,
   and label every figure from them as secondary.

## Rules

- **Match exact versions.** `gpt-6-sol` and `gpt-6.1-sol` are different
  models; so are `v3` and `v3.1` of an SDK. Check the version on every figure
  before you use it.
- **Match settings.** Compare models only at the same effort level and
  harness. A score without its effort level is not comparable.
- **Attribute each figure** to its source, and say whether it is vendor-
  reported or independent.
- **When sources conflict,** give the range and say they conflict. Do not
  pick the convenient number.
- **Before a command goes into a rule, skill, or config,** run it once in the
  scratchpad (a smoke run) and show the output.
- **If you cannot verify,** say what you could not check and why. Do not fill
  the gap from memory.
