---
name: pr-autofix
description: Handle one auto-fix round on this session's pull request — failing CI, merge conflicts and review comments — then report the result to Herdr. Herdr sends it as /herdr-app:pr-autofix.
disable-model-invocation: true
---

# PR auto-fix round

Herdr sends you a round when this session's PR needs work. The message lists what changed: merge conflicts, failing checks, review comments. "The author" is the person who owns this PR and this session. Your replies post from the author's account.

Work in this worktree, in this order: conflicts, then CI, then comments. A merge can fix a check or move the lines a comment is about. Skip an item that is already handled: a check that now passes, a resolved thread. Then report (step 5).

## Rules

Read `~/.claude/skills/herdr-app/skills/pr-fix/SKILL.md` and follow its Rules. Never reply in a thread that the author started (origin `author`).

## 1. Conflicts

Update the branch as `~/.claude/skills/herdr-app/skills/update-branch/SKILL.md` says.

## 2. Failing CI

Handle each failed check as the CI section of `pr-fix/SKILL.md` says.

If step 1 pushed a merge, CI runs again on the new commit. Do not rerun the old runs, and skip base-branch failures. Fix only failures that the branch itself causes. Herdr sends the new results in the next round.

Otherwise, update the branch at most once for base-branch failures, however many checks fail that way.

## 3. Review comments

The message lists two kinds of items:

- **Threads**: inline comments on a line. Each has its origin (`bot` for the review bot, `human` for a teammate, `author`) and the author's signal, if any. The signal is the author's 👍 on the first comment, or the author's latest reply in the thread.
- **Review summaries**: the text of a review, with no thread, from a person (origin `human`) or the review bot (`bot`). The review bot often puts its pre-existing findings there. Treat each finding or request in the summary like a thread.

Read an item in full with `gh api` when the excerpt is not enough.

Decide each thread with these rules. The first rule that matches decides.

1. Estimate the size first. More than about 50 changed lines, or files the PR does not touch yet: always ask.
2. The author's own comment, or the author's reply in the thread: do what it says. If it is unclear or is a question, ask. If it says to ignore the comment, reply in one sentence with why (unless the author started the thread), then resolve it. For the review bot, add 👎 first. Never react 👎 to a person's comment.
3. The author's 👍: fix it.
4. The review bot left 3 or more reviews on this PR (`gh pr view --json reviews`) and only nits (💬) or pre-existing findings (🟣) are left: ask about all of them at once instead of fixing.
5. Pre-existing findings (🟣) are about code the PR did not cause: ask. Offer **Fix it here**, **Spin it off** (a new session with the herdr-app:spin-off skill), **Ignore it**.
6. No signal: fix it when the fix is technical and simple. Ask when it changes behavior, or when the reviewer is unsure (the comment is a question or hedges).

Fix, reply, react and resolve as the Comments section of `pr-fix/SKILL.md` says.

A review summary has no thread to resolve. When you have handled all its findings (fixed, or the author answered), add 👍 to the review itself (`subjectId` = the review id). When the author says to ignore it, add 👎 (`content:THUMBS_DOWN`) to the review bot's review, or 👀 (`content:EYES`) to a person's. Herdr stops sending a review once you have reacted to it.

## 4. Then

Do not start other work. Herdr marks the PR ready for review when a round finds nothing left, so do not do it yourself. Do not merge it or request reviews.

## 5. Report to Herdr

At the end of the round, and again each time you finish auto-fix work after the author answers you, write the status:

```sh
mkdir -p ~/.config/herdr-app/data/autofix
printf '{"state":"%s","reason":"%s"}\n' <done|needs_you> "<one short line>" > ~/.config/herdr-app/data/autofix/<PR number>.json
```

Use `needs_you` when you asked the author something or stopped at a limit, and `done` otherwise. Keep `reason` free of quotes and line breaks. Then reply with a short summary: what you fixed, what you pushed, and what you need from the author.
