---
name: feature
description: Runs plan → approve → execute → (scoped review) → (architect) for a feature, in one of three modes (lite, standard, full)
disable-model-invocation: true
---

Run the development cycle for: $ARGUMENTS

The text may start with a mode word: `lite`, `standard` or `full`. If it does, use that mode. If not, the planner recommends one and I choose when I approve the plan. Tokens are the scarce resource (100k tokens is about 10% of the owner's five-hour limit), so the cycle is short by default. Every agent starts from `.claude/agent-brief.md`.

## Modes

- `lite`: plan, execute, one final check pass. No reviewer, no architect. For UI, copy, small screens, config.
- `standard` (default when I do not choose): plan, execute, one final check pass, then ONE scoped review. For most features.
- `full`: standard plus an architect sign-off. For a new module or table, a new dependency, a boundary change, or anything centred on auth, keys or data access. Use Opus for the planner and the reviewer here (pass `model: "opus"` to the Agent tool); in the other modes they run on Sonnet.

## Steps

1. **Plan.** Run the `planner` subagent with the task and the mode if one was given. It returns a plan cut into slices (AGENTS.md, "Slices and reviewability"): per slice a table of files, one line each with what and why and `core` or `boilerplate`, then the risk tiers, the checks, the flags, whether `MAP.md` needs an update, and a mode recommendation with a rough token cost. If a slice is over the ceiling, the planner has already cut it or asked why it cannot be cut. Show it to me and stop. Nothing is touched before I approve.

2. **Execute.** Run the `executor` subagent on the approved plan, one slice at a time, with the fast check after each step. After each slice it measures the slice, writes the slice report in Russian (was, is now, why; reading order; the 1 to 3 files with logic or risk; what to skim; MAP.md yes or no) and stops. Show me that report and wait before the next slice. If my request said "commit the slices yourself", the executor commits each slice (one commit, its own doc changes included) before reporting; otherwise I commit. If the plan marks steps as independent (different directories, no shared dependency or lockfile change), run those executors in parallel in the same working tree; dependency installs and shared config are done first by a single executor. Do not use git worktrees: they lack `node_modules` and the git-ignored env files. At the end of each slice it runs typecheck and test of the affected projects. At the last slice (and in any slice with a migration) it runs the plan's single full pass (lint, typecheck, test for the affected projects, plus build and integration tests when the API changed). Not after every step.

3. **Scoped review (standard and full).** Run the `reviewer` once, near the end, and give it exactly this: the list of files to review (the `high` steps and the riskiest `medium` ones, not the whole diff), the check numbers that apply from its list, the executor's result lines, and what is already accepted (known limitations from the plan or from ARCHITECTURE.md section 11). It reads those files, runs no `nx`, and reports at most 8 findings. On CHANGES_REQUESTED, fix the blocking items and run a second round limited to the changes made for them. Fixes for review findings are a separate commit (`feat` or `refactor`), not a rewrite of the committed slices. Two rounds at most. If it is still not approved, stop and show me the findings, the diff stat and the last review.

4. **Architect (full only).** After the reviewer approves, run the `architect` once with the list of changed files. If it asks for changes, fix them and show me; there is no loop. I decide what happens next.

5. **Done.** Report in this order:
   - what changed (slices and files grouped by area, no long listing);
   - the commands that ran and their result lines;
   - the verdicts, if any ran;
   - **a token table**: one row per subagent run (agent, round, tokens from its completion notice) and a total, so I can see what the cycle cost;
   - MAP.md: update needed, yes or no, and why (if yes, do it as part of the last slice's commit, after I agree);
   - what must be checked on a phone, as one numbered checklist for a single session.
   Then wait for me. I make the commits unless I ask you to.
