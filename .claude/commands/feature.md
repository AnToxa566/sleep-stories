---
name: feature
description: Runs the full plan → approve → execute → review → architect cycle for a feature or change
disable-model-invocation: true
---

Run the full development cycle for: $ARGUMENTS

1. **Plan.** Use the `planner` subagent to read AGENTS.md, ARCHITECTURE.md, and SECURITY.md where the task calls for it, then produce a plan in its format. Stop and show me the plan for approval before touching any files.

2. **Execute.** Once I approve, implement it as the `executor` subagent: one step at a time, running verification after each, never skipping ahead.

3. **Review loop.** Use the `reviewer` subagent on the diff, in a fresh context. On CHANGES_REQUESTED, fix the blocking items and re-run the reviewer. Repeat until APPROVED, up to 5 rounds — if it is still not approved after 5, stop and show me the plan, the diff and the last review so I can decide instead of looping.

4. **Architect sign-off.** Once the reviewer approves, use the `architect` subagent for structural fit. On CHANGES_REQUESTED, fix and go back through step 3 before returning here. Up to 3 rounds, same stop rule.

5. **Done.** Summarize what changed, which files, which commands ran and their results, and both verdicts. Wait for me before committing.
