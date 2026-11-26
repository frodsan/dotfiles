---
name: pr-autofix
description: Handle one auto-fix round on this session's pull request — failing CI, merge conflicts and review comments — then report the result to Herdr. Herdr sends it as /herdr-app:pr-autofix.
disable-model-invocation: true
---

# PR auto-fix round

Herdr sends you a round when this session's PR needs work and the session is idle. The message lists what changed: failing checks, merge conflicts, review threads. Handle the round in this worktree, then report (step 5).

## Rules

Read `~/.claude/skills/herdr-app/skills/pr-fix/SKILL.md` and follow its Rules. Threads from origin `you` are your own: never reply to them.

## 1. Conflicts

Update the branch as `~/.claude/skills/herdr-app/skills/update-branch/SKILL.md` says.

## 2. Failing CI

Handle each failed check as the CI section of that pr-fix file says. Merge the base at most once per round.

## 3. Review comments

The message lists two kinds of items:

- **Threads**: inline comments on a line. Each has its origin (`bot` for the review bot, `human` or `you`) and the PR author's signal, if any.
- **Review summaries**: the text of a review, with no thread. The review bot can put findings there, often the pre-existing ones. Treat each finding in the summary like a thread.

Read an item in full with `gh api` when the excerpt is not enough.

Decide each thread:

1. Estimate the size first. More than about 50 changed lines, or files the PR does not touch yet: always ask.
2. Your own comment, or your reply in the thread: do what it says. If it is unclear or is a question, ask. If it says to ignore the comment, reply in one sentence with why (unless it is your own thread), then resolve it. For the review bot, add 👎 first.
3. Your 👍: fix it.
4. No signal: fix it when the fix is technical and simple. Ask when it changes behavior, or when the reviewer is unsure (the comment is a question or hedges).
5. Pre-existing findings (🟣) are about code the PR did not cause: ask. Offer **Fix it here**, **Spin it off** (a new session with the herdr-app:spin-off skill), **Ignore it**.
6. The review bot reviewed the PR 3 or more times and only nits or pre-existing findings are left: ask about all of them at once instead of fixing.

Fix, reply, react and resolve as the Comments section of that pr-fix file says.

A review summary has no thread to resolve. When you have handled all its findings (fixed, or the user answered), add 👍 to the review itself (`subjectId` = the review id). When the user says to ignore it, add 👎 instead (`content:THUMBS_DOWN`). Herdr stops sending a review once you have reacted to it.

## 4. Then

Do not start other work. Do not mark the PR ready, merge it, or request reviews.

## 5. Report to Herdr

At the end of the round, and again each time you finish auto-fix work after the user answers you, write the status:

```sh
mkdir -p ~/.config/herdr-app/data/autofix
printf '{"state":"%s","reason":"%s"}\n' <done|needs_you> "<one short line>" > ~/.config/herdr-app/data/autofix/<PR number>.json
```

Use `needs_you` when you asked the user something or stopped at a limit, and `done` otherwise. Keep `reason` free of quotes and line breaks. Then reply with a short summary: what you fixed, what you pushed, and what you need from the user.
