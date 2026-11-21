---
name: spin-off
description: Start a side task (usually a separate PR) as a new background Herdr session with its own worktree and a written brief, then continue the current task. Use when the user says "spin off", "spin this off", or asks to do related work in parallel without leaving this session.
---

# Spin off a side task

The user wants a side task done in a new Herdr session while this session continues. You write the brief, start the session, and then go back to the current work.

## 1. Decide the base

- `master`: the side task does not need anything from this branch. This is the default.
- `stack`: the side task needs code from this branch that is not on the default branch yet. The new branch starts from this branch, and its PR targets this branch.

If you are not sure, use `master` and say so in one line.

## 2. Write the brief

The new session has none of this conversation. The brief is everything it knows. Write it for a capable engineer who just joined:

- **Goal:** what to change and why, in one or two sentences.
- **Context:** the facts from this conversation that matter. Name the exact files, classes, methods and commands. Include decisions already made, and the reasons.
- **Scope:** what not to touch. This includes the work that stays in this session.
- **Done when:** the result to aim for, for example "a draft PR with passing specs".

Keep it short: usually 100–250 words. Do not paste long code. Point to the files.

## 3. Start the session

Write the request with `jq`, so the text is escaped correctly, then tell Herdr:

```sh
mkdir -p ~/.config/herdr-app/data/spinoff
jq -n --arg cwd "$PWD" --arg title "<short session title>" --arg base "<master|stack>" --arg brief "<the brief>" \
  '{cwd: $cwd, title: $title, base: $base, brief: $brief}' \
  > ~/.config/herdr-app/data/spinoff/$(date +%s)-$$.json
herdr-app do sessions.spinoff
```

- `cwd` must be this session's working folder, so Herdr finds the repo, the section and the branch.
- `title` is the session name in the sidebar: 3–8 words.
- Optional: add `--arg mode "plan"` and `mode: $mode` to start it in plan mode. The default is `auto`.

Herdr creates the worktree, runs the folder's setup command, and starts Claude with the brief. The new session goes in the same section, and into focus mode when this one is in focus. A toast confirms it, or shows an error. The sidebar also picks up the request within 2 seconds if the `do` command fails.

## 4. Continue

Tell the user in one line what you spun off and on which base. Then continue the current task. Do not wait for the new session, and do not work on the side task here.
