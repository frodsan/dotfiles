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

From a clone, run `./install.sh` directly. `install.sh` does three things:

1. It installs Homebrew if `brew` is missing.
2. It installs the packages in `Brewfile` with `brew bundle`.
3. It links each path in its `FILES` list from the repo into your home folder.

The script prints one line per path. When a path already exists in your home folder and isn't the link, the script skips it and says whether its content matches the repo. Run `./install.sh --force`, or set `FORCE=1`, to replace those paths. With `--force`, each existing path moves to `<name>.bak` first, so the script never deletes files.

`brew bundle` runs with `--no-upgrade`, so the script installs missing packages and leaves installed ones at their current version. You can run it again at any time.

## Herdr

`.config/herdr-app` holds my Herdr setup: the sessions sidebar with focus mode and chats, the pull request sidebar with auto-fix and merge when ready, Neovim and lazygit beside Claude, a tabs bar, a command palette, and the `firehouse` layout and theme. `.claude/skills/herdr-app` is a Claude Code plugin named `herdr-app` with the two skills it uses: `herdr-app:pr-autofix`, which auto-fix sends, and `/herdr-app:spin-off`. Claude Code loads a plugin folder in `~/.claude/skills` at every start, with no marketplace.

- The script links each mod folder, the layout, the theme and `keys.json`. It copies `settings.json` once, because Herdr rewrites that file itself.
- In Herdr, pick the layout once with `ctrl-shift-l` or the `layout.switch` command: `firehouse`.
- Open the settings with `⇧⌘,` and the shortcuts with `⌘?`.
- Other mods can add an icon and a view to the sidebar with a `sidebar.json` file in their folder. The `layout:work` keys in `keys.json` are for a private layout with such mods, and do nothing without it.

## Add a file

1. Copy the file into the repo at the same path it has under your home folder.
2. Add that path to `FILES` in `install.sh`.
3. Run `./install.sh`.
