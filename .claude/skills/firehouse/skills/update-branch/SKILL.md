---
name: update-branch
description: Merge the latest base branch into the current branch, fix the conflicts, then commit and push. Herdr sends it as /firehouse:update-branch from the session menu and the PR panel.
disable-model-invocation: true
---

# Update branch

## 1. Find the base

- If an argument names a branch, use it.
- Otherwise use the pull request's base: `gh pr view --json baseRefName -q .baseRefName`.
- With no pull request, use the default branch: `git symbolic-ref --short refs/remotes/origin/HEAD`, without `origin/`.

## 2. Check the branch

- If there are uncommitted changes, stop and ask. Never stash them yourself.
- If the current branch is the base itself, stop and say so.

## 3. Merge

`git fetch origin <base>`, then `git merge origin/<base>`.

- If it says "Already up to date", say so and stop.
- Never rebase, never force-push, never skip hooks (`--no-verify`).

## 4. Fix the conflicts

- Keep the intent of both sides.
- For generated files, use the generators that the repo's CLAUDE.md or docs name. Never edit a generated file by hand.
- If a conflict is not clear, run `git merge --abort` and ask, with the files and hunks.

## 5. Check, commit, push

- Run the specs of the files that had conflicts, and `pre-commit run --files <files>`.
- Commit with the default merge message, then push.

## 6. Report

Say in one or two sentences what came in from the base, which files had conflicts and how you resolved them, and the short SHA of the merge commit.
