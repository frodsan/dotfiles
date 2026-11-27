# Firehouse

A Herdr layout for running many Claude Code sessions on git repos at once. The left sidebar lists sessions grouped by repo, each with a status dot and its pull request. The right side shows the active session's tabs as pills, its panes as cards and a Pull request panel. Each session is a Herdr space with its own git worktree and Claude. Claude fixes CI failures, conflicts and review comments on its own pull requests. A session settles after its pull request merges. A second sidebar list holds chats with Claude that belong to no repo.

## What you see

The window has no system title bar. The macOS window buttons sit at 12px, 16px. The window background is `canvas`, `#262624`. Dividers are 1px `border`, `#3e3d39`.

Left to right:

1. **Sidebar**, 296px wide, between 200px and 520px, background `chrome`, `#1f1e1d`. Top to bottom:
   - Brand row, 46px, Herdr's `workspace-chrome` mod. It drags the window.
   - Header row, 34px, 14px icons in `dim`, `#85837b`. On the left: chats, focus mode, reviews with a 7px `accent` dot while pull requests wait, and one icon per sidebar extension. On the right: settings. An active icon is `accent`, `#d97757`, on `raised`, `#30302e`.
   - The list, a stack of three children: sessions, chats and reviews. The sessions list shows first, under a "Sessions" heading with add a folder and new session buttons.
   - Two 0px blocks: a background copy of `chats` and `custom-commands`.
   - Footer, 69px, `workspace-chrome` with its footer role: Settings and Add machine.
2. **Work column**. Top to bottom:
   - Tab bar, 42px, `chrome`, 1px bottom border. It drags the window. Tab pills are 29px tall, 10px side padding, 7px corners, 12.8px text, names cut at 170px. The active pill is `raised` with a `border` outline and a close button. Each pill shows the program icon, a spinning 12px spinner in `working`, `#e3b341`, while an agent works, and a 6px dot in `blocked`, `#f0883e`, or `done`, `#3fb950`. On the right are 26px buttons: Files, Changes and Pull request. The Pull request button shows the number, such as `#1234`, and a 7px CI dot. The dot is `ansi1`, `#f85149`, for failed, `working` for running and `done` for passed. When auto-fix is waiting, an "Auto-fix: …" button with a wrench and a "Run" label comes before them.
   - Body, a row with 8px padding and 8px gaps. The active tab's panes are cards with 10px corners, a 1px `border` frame and a 1px `accent` frame when focused. Each card has Herdr's `pane` header, 30px, at the top. Terminal padding is 14px by 12px.
   - Pull request panel, on the right of the body, 368px wide, between 280px and 900px, hidden at start.
   - Status bar, 28px, Herdr's `workspace-status` mod.

Type is Herdr's UI font. Sidebar rows are 13px, meta lines 11px to 12px.

**Session row.** 6px by 8px padding, 6px corners, `selected`, `#45443f`, when active. A 7px status dot: `working` pulsing from 35% to 100% opacity every 1.2 seconds, `blocked`, `done`, or `idle`, `#85837b`, at 60%. Then the name and a meta line. With a pull request, the meta line is `#1234`, the review state, Merged, Closed or Draft, and its age. A review state is "Approved" in `done`, "Changes requested" in `ansi1` or "Review" in `dim`. A pull request icon in front is `done` when open, `ansi5`, `#a371f7`, when merged and `ansi1` when closed. On hover, a star and a settle button appear.

**Groups.** Folders, then Working, Snoozed and Settled. Working, Snoozed and Settled fold, and show a count such as "Settled · 34".

**Chats list.** A "Chats" heading with a + button, then one row per chat: a 6px dot, the name and "5m ago". On hover, an archive button and a remove button appear. A folded "Archived · N" group is at the bottom.

**Dialogs**, `popover`, `#30302e`: new session, Firehouse settings, keyboard shortcuts, custom commands and welcome.

## How it behaves

**Agent status.** Working shows a pulsing `working` dot in the row and a spinner in the tab pill. Blocked and done show solid `blocked` and `done` dots, and count as needing you. Idle shows a dimmed `idle` dot.

**Keys.** These are in `keys.json`:

| Key | Action |
|---|---|
| `⌥⌘N` | New session dialog. It takes a prompt and a folder. |
| `⌘↑`, `⌘↓` | Previous and next session in the order the sidebar shows. |
| `⇧⌘F` | Focus mode. It shows starred sessions only and turns sounds off. |
| `⇧⌘G` | Opens the pull request on GitHub. |
| `⌘E` | Files: Neovim in a tab, in the session's worktree. |
| `⌥⌘C` | Changes: lazygit in a pane on the right. |
| `⇧⌘T` | A "Rails console" tab running `bin/rails console`. |
| `⌥⌘P` | Shows or hides the Pull request panel. |
| `⇧⌘C` | Swaps the sessions list and the chats list. |
| `⇧⌘R` | Swaps the sessions list and the reviews list. |
| `⇧⌘N` | New chat. |
| `⇧⌘,` | Firehouse settings. The gear in the header opens it too. |
| `⌘,` | A Claude session in the folder that holds this config. |
| `⇧⌘/` | Keyboard shortcuts dialog. |

**New session.** Herdr fetches the default branch and creates a worktree with `wt switch <branch> --create`. Worktrunk runs its hooks, and Herdr starts Claude with the prompt. The branch is the settings prefix plus a slug that `claude -p --model haiku` writes, with a fallback from the prompt words.

**Clicks.** A row click selects the space and focuses its Claude pane. Right-clicking a row opens its menu: open the pull request on GitHub, update the branch, settle, rename, move to a section and remove. A starred session's menu also has Snooze… and Pin. A snoozed row has a clock button to change the time or unsnooze. Dragging moves a session.

**Pull request panel.** It shows checks, reviews and the branch state. It has an update-branch button and three toggles. Fix turns on auto-fix. Merge turns on merge when ready. Settle turns on auto-settle.

**Auto-fix.** Every 2 minutes, Herdr reads failed checks, conflicts, unresolved review threads and 👎 reactions with `gh api graphql`. It sends the work to the session's Claude with `hc send` as a `/firehouse:pr-autofix` request. While you look at the session, it waits and shows the "Auto-fix" button in the tab bar. After 5 rounds of review threads, or when Claude writes `needs_you` to `data/autofix/<PR>.json`, it stops and marks the session blocked. A 👎 from someone else on a reply that contains `[AI-generated]` posts a warning notification.

**Merge when ready.** Herdr adds the pull request to GitHub's merge queue once it is approved, mergeable and not a draft, and its merge state is clean, unstable or has hooks. It takes the pull request out of the queue while auto-fix works on it, and queues it again afterwards.

**Settle.** A merged or closed pull request moves its session to Settled. After the keep setting, 7 days by default, Herdr removes the worktree, uncommitted changes included, and the Claude conversation, with `git worktree remove --force`. The branch always stays, with its commits. "Remove now" before then keeps a worktree with uncommitted changes or unpushed commits, marks it kept, and offers to remove it anyway. The Settled heading has "Remove kept · N" to remove every kept one. Restore brings Claude back on the same conversation.

**Snooze.** It hides a session until a time, such as tomorrow at 9:00 or next Monday at 9:00. The settings set the hour. Auto-fix wakes a snoozed session early when it needs you. In focus mode, that plays the blocked sound.

**Chats.** A new chat opens a space in `data/chats/workspace` running `claude --session-id <uuid>`. Opening a closed chat runs `claude --resume <uuid>`. The background copy names each chat once with `claude -p --model haiku` from its first message, and marks it `titled`. When Claude exits, the space closes and the chat moves to Archived. Opening an archived chat restores it. After the keep setting, an archived chat's conversation moves to `~/.Trash`.

**Custom commands.** The palette's "Edit custom commands…" opens an editor of title and shell command pairs. Each one becomes a palette entry that opens a terminal on the right running the command in the login shell.

## Built from

Layout `layouts/Firehouse.json`:

```
root row
  sidebar column, 296px
    brand block, 46px: workspace-chrome
    sidebar-header block, 34px: sessions {header: true}
    sidebar-lists stack, active "sessions"
      sessions block: sessions
      chats block: chats
      reviews block: reviews
    chats-watch block, 0px: chats {watch: true}
    reviews-watch block, 0px: reviews {watch: true}
    custom-commands block, 0px: custom-commands
    sidebar-footer block, 69px: workspace-chrome {footer: true}
  views stack, active "work"
    work column
      tabs block, 42px: sessions {bar: true}
      work-body row, padding 8, gap 8
        main block: the active tab, pane header mod "pane"
        panel column, 368px, hidden
          panel-body stack: pull-request block: sessions {pr: true}
      status block, 28px: workspace-status
    reviews-view block: reviews {view: true}
```

Theme `themes/firehouse.json`. Shortcuts `keys.json`.

Mods:

- `sessions`. With no props it is the list and owns all background work. Its roles are `header`, `bar`, `pr`, `composer`, `menu` and `welcome`. The header is the only copy that takes `sessions.*` commands. It forwards the rest to the list through the shared key `sessions.forward`. Code is split into `main.js`, `bar.js` for the tab bar, `pr.js` for the panel and `config.js` for the settings defaults. Icons are in `assets/`.
- `chats`. With no props it draws the list. With `watch` it links new chat spaces, names them, closes exited chats, moves old archived chats to the Trash and handles `chats.new`.
- `custom-commands`. With no props it publishes the palette entries into a generated mod, `mods/custom-commands-local`. With `editor` it is the editor dialog.
- `firehouse-settings`. The Firehouse settings dialog. It holds its own copy of the defaults and writes the shared key `firehouse.settings`. Its last group, GitHub API, runs `gh api rate_limit` when it opens and every 10 seconds, and shows the GraphQL, REST and search limits with bars and reset times.
- `shortcuts`. The shortcuts dialog. It reads `keys()`.

- `reviews`. With `watch` it runs a GraphQL search for `is:pr is:open user-review-requested:@me` every 2 minutes, or as Firehouse settings says, and saves `{ items, at, error }` in the shared key `reviews.list`. Pull requests that leave the list move to `reviews.settled` for a day, with the reason: approved, merged, closed or no longer requested. The same copy runs Check with Claude, at most 3 at a time, as `claude -p` with read-only tools in the repo's main checkout, and saves the state in `reviews.claude` and the reports in `data/reviews/`. With no props it draws the list, grouped by repo, with folded Snoozed and Settled groups. With `menu` it is the right-click menu: Spin off a session, Snooze…, and Open on GitHub. Snooze… opens the sessions snooze menu with `store: "reviews.snoozed"` and the head commit, so new commits wake it. With `view` it is the main panel view in the `reviews-view` block of the `views` stack: Description, Files, Reviews and Findings tabs, and Approve with a confirmation. Files reads CODEOWNERS and your teams through `gh`, and shows only your files until you pick Show all. Comments from bot accounts are hidden. Spin off a session puts the link in `sessions.composerText` and runs `sessions.new-session`, so the new session dialog opens in pull request mode.

Shipped mods it uses: `workspace-chrome`, `workspace-status`, `pane`, `menu`, `files` and `changes` for their icons.

`herdr` functions: `spaces`, `panes`, `layout`, `keys`, `machines`, `window`, `settings`, `shared`, `setShared`, `props`, `nextCommand`, `run`, `exec`, `hc`, `openOverlay`, `closeOverlay`, `notify`, `playSound`, `pickFolder`, `readTextFile`, `writeTextFile`, `appHome`, `home` and `checking`.

App commands: `space.new`, `space.select`, `space.close`, `space.rename`, `tab.new`, `tab.select`, `tab.close`, `tab.move`, `tab.rename`, `pane.focus`, `pane.close`, `terminal.open`, `layout.select`, `layout.show`, `layout.hide` and `window.minimize`, `window.maximize` and `window.close`.

Programs: `gh`, `git`, `wt`, `claude`, `nvim`, `lazygit`, `bin/rails`, `sh`, `open`, `dscl`, `mkdir`, `test`, `rm` and `rmdir`.

Shared keys: `firehouse.settings` holds the settings, `commands.list` the custom commands, and `chats.space` the chat to space links. Files go under `~/.config/herdr-app/data/`: `new-session/`, `spinoff/`, `autofix/` and `chats/`.

## Watch out

- The mods reach GitHub through `gh`, run programs with `exec` and `hc`, and read `~/.claude/projects` for chat titles and conversations.
- Auto-fix, the update-branch button and spin-offs call Claude Code skills from the `firehouse` plugin: `pr-autofix`, `pr-fix`, `update-branch` and `spin-off`. In this repo they are in `.claude/skills/firehouse`. Without them those features do nothing.
- `shared(key)` returns `null` for a missing key. Test with `== null`, not `=== undefined`.
- A mod copy starts the first time its block shows. A stack child that never showed, like the chats list, runs no timers. Background work needs a 0px block. Only one copy should handle a mod command, so the chats list does not call `nextCommand()`.
- Herdr runs `argv` agents in the login shell, which stays open after the agent exits. After Claude exits, the terminal still reports `app: "claude-code"`. Check `program.key === "claude"` or an agent status instead.
- `hc send` delivers text as a message from another terminal, so Claude does not run `/exit` from it. To test an exit, press `ctrl+d` twice with `hc keys`.
- Herdr does not reload a mod folder that is a link when a file behind the link changes. Copy mod folders into `~/.config/herdr-app/mods` instead of linking them.
- The auto-fix reply check matches `[AI-generated]`, the label that the `pr-fix` skill writes. Change both together.
- It assumes macOS: `dscl` for the login shell, `~/.Trash`, and the window button spot.
- The Rails console key assumes a `bin/rails` in the worktree.

## Done when

- `herdr-app check` passes for `mods/sessions`, `mods/chats`, `mods/custom-commands` and `mods/shortcuts`, and `herdr-app status` shows no errors.
- `layout.switch {name: "Firehouse"}` shows the sidebar, the tab bar and the status bar with the sizes above.
- `⌥⌘N` with a prompt creates a worktree on a new branch with the settings prefix, and the space shows Claude working with a pulsing dot.
- A session with an open pull request shows its number, review state and CI dot, and `⌥⌘P` opens the panel with its checks.
- `herdr-app do chats.new` works while the chats list is hidden, and pressing `ctrl+d` twice in that chat closes its space within 2 seconds and moves the chat to Archived.
- `⇧⌘R` shows the pull requests waiting for your review, and a click shows one in the main panel with only your files under Files.
- `⇧⌘/` lists every key from `keys.json`, and `⇧⌘,` opens Firehouse settings.
- A custom command added in the editor shows in the command palette and opens a terminal on the right.
