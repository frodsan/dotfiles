# dotfiles

My macOS config for zsh, git, Ruby, PostgreSQL and Neovim with LazyVim.

Each zsh file loads a matching `.local` file when it exists: `~/.zshenv.local`, `~/.zprofile.local` and `~/.zshrc.local`. Put machine-specific and work settings there. Git ignores them.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/frodsan/dotfiles/master/install.sh | bash
```

To replace existing files, add `--force`:

```sh
curl -fsSL https://raw.githubusercontent.com/frodsan/dotfiles/master/install.sh | bash -s -- --force
```

From `curl`, the script first gets the repo:

1. It installs the Xcode Command Line Tools if they are missing. They include `git`. Confirm the dialog that macOS shows.
2. It creates `~/Code/frodsan` if needed and clones the repo into `~/Code/frodsan/dotfiles`. If the clone already exists, it updates it with `git pull --ff-only`. Set `DOTFILES_DIR` to clone somewhere else.
3. It runs the clone's `install.sh` with the same options.

From a clone, run `./install.sh` directly. `install.sh` does four things:

1. It installs Homebrew if `brew` is missing.
2. It installs the packages in `Brewfile` with `brew bundle`.
3. It links each path in its `FILES` list from the repo into your home folder.
4. It installs the skills in `SKILLS` that are missing.

The script prints one line per path. When a path already exists in your home folder and isn't the link, the script skips it and says whether its content matches the repo. Run `./install.sh --force`, or set `FORCE=1`, to replace those paths. With `--force`, each existing path moves to `<name>.bak` first, so the script never deletes files.

`brew bundle` runs with `--no-upgrade`, so the script installs missing packages and leaves installed ones at their current version. You can run it again at any time.

## Claude Code

`.claude/CLAUDE.md` holds my instructions for every Claude Code session: writing style and pull request descriptions. Claude Code loads `~/.claude/CLAUDE.md` at every start.

`.claude/rules` holds rules for one kind of file, such as `ruby.md` for Ruby style. Each file has a `paths:` header, and Claude Code loads it only after it reads or edits a matching file. `install.sh` links each rule file, not the folder, so `~/.claude/rules` can also hold private rules that stay out of this repo. Put work rules in a `CLAUDE.local.md` in the folder above your work repos, for example `~/Code/<company>/CLAUDE.local.md`. Claude Code loads it in every repo and worktree under that folder, and it stays out of this repo.

`SKILLS` lists the third-party skills to install, one `owner/repo@skill` per line. `install.sh` installs each missing one for Claude Code with `npx skills add <source> -g -a claude-code -y`. It needs Node.js 22.20 or later, which the `Brewfile` installs. To add a skill, read it first, then add its line and run `./install.sh`. To update installed skills, run `npx skills update -g`.

## Herdr

`.config/herdr-app` holds my Herdr setup: the sessions sidebar with focus mode and chats, the pull request sidebar with auto-fix and merge when ready, Neovim and lazygit beside Claude, a tabs bar, your own commands in Herdr's command palette, and the `firehouse` layout and theme. `.claude/skills/herdr-app` is a Claude Code plugin named `herdr-app` with the two skills it uses: `herdr-app:pr-autofix`, which auto-fix sends, and `/herdr-app:spin-off`. Claude Code loads a plugin folder in `~/.claude/skills` at every start, with no marketplace.

- The script links each mod folder, the layout, the theme and `keys.json`. It copies `settings.json` once, because Herdr rewrites that file itself.
- In Herdr, pick the layout once with `ctrl-shift-l` or the `layout.switch` command: `firehouse`.
- Open the settings with `⇧⌘,` and the shortcuts with `⌘?`.
- Other mods can add an icon and a view to the sidebar with a `sidebar.json` file in their folder.
- Set the review bot and your palette commands in the settings. They stay on the machine, out of this repo. Each command has a title and a shell command, and runs in the folder of the focused terminal. Start it with `cd` to run it somewhere else.

## Add a file

1. Copy the file into the repo at the same path it has under your home folder.
2. Add that path to `FILES` in `install.sh`.
3. Run `./install.sh`.
