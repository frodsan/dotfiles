# Firehouse

Firehouse is a Herdr setup for running many Claude Code sessions on one repo at the same time. Each task gets its own git worktree and its own Claude. The sidebar shows which session needs you. Claude fixes the CI failures, conflicts and review comments on its own pull requests, and a session cleans itself up after its pull request merges.

## Start a task in one keystroke

Press `⌥⌘N` and type what you want. Firehouse creates a worktree and a branch with Worktrunk, such as `fr/fix-login-1a2b`, and starts Claude with your prompt. Worktrunk's `post-start` hooks set up the worktree in the background. You never stash, switch branches or wait for another task to finish.

When a task turns up a side task, spin it off. The `herdr:spin-off` skill writes a brief, and Firehouse starts the side task as a new session on its own branch. The first session keeps going.

## See what needs you

The sidebar groups sessions by repo and shows each one's state: working, blocked on you, or done. `⌘↑` and `⌘↓` move between sessions.

Focus mode (`⇧⌘F`) shows only the sessions you starred and turns sounds off. Snooze a session until tomorrow morning or next week, and it comes back on its own.

## Pull requests that finish themselves

The Pull request panel (`⌥⌘P`) shows the checks and reviews of the session's pull request. It has three toggles.

- **Fix.** Every 2 minutes, Firehouse checks for failed CI, merge conflicts and new review comments, and hands them to Claude. Claude reruns flaky jobs, fixes real failures, replies to reviewers and resolves their threads. After 5 rounds of review comments, it stops and asks you. Each reply starts with `[AI-generated]` and asks the reviewer to react 👎 if it's wrong. A 👎 sends you a notification.
- **Merge.** Firehouse puts the pull request in the merge queue once it's ready. If auto-fix starts on it again, Firehouse takes it out of the queue and puts it back when the fix is done.
- **Settle.** When the pull request merges or closes, the session moves to Settled. After 7 days, Firehouse deletes its worktree and Claude conversation, uncommitted changes included. The branch stays, with its commits.

## Every tool one key away

The tab bar opens tools beside Claude, in the session's worktree: Files in Neovim (`⌘E`), Changes in lazygit (`⌥⌘C`) and a Rails console (`⇧⌘T`). `⇧⌘G` opens the pull request on GitHub.

`⇧⌘/` shows every shortcut. The list reads `keys.json`, so it shows the keys you set.

![The keyboard shortcuts dialog](docs/shortcuts.png)

## Chats for everything else

Some questions belong to no repo. `⇧⌘C` swaps the session list for your chats with Claude, and `⇧⌘N` starts a new one. Each chat names itself after the conversation. Exiting Claude archives the chat, and opening it again resumes the conversation. Archived chats go to the Trash after 7 days.

## Reviews without leaving Herdr

`⇧⌘R` swaps the session list for the pull requests that list you as a reviewer, not through a team, refreshed every 2 minutes by default. A dot on its icon says some are waiting. Click one, and it opens in tuicr in a Reviews space, one tab per pull request. Read the diff, comment, then approve or request changes, and tuicr sends the review to GitHub. `⇧⌘G` opens the pull request of the review tab on GitHub. Right-click a pull request to snooze it, or to check it out in a new session and change the code yourself.

## Your own commands

Add shell commands to the command palette with "Edit custom commands…", such as an AWS login or `claude /mcp`. Each one opens a terminal on the right. They stay on your machine and out of this repo.

## Change it with Claude

`⌘,` opens a Claude session in this repo to change the setup itself. `⇧⌘,`, or the gear in the sidebar header, opens Firehouse settings: branch prefix, settling, focus mode, snooze time, how often reviews refresh, and toasts.

## Install

Paste this into Claude Code:

```
Read ~/.config/herdr-app/AGENTS.md, then add this layout: https://github.com/frodsan/dotfiles/tree/master/.config/herdr-app
Also copy https://github.com/frodsan/dotfiles/tree/master/.claude/skills/herdr to ~/.claude/skills/herdr.
```
