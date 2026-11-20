# dotfiles

My macOS config for zsh, git, Ruby, PostgreSQL and Neovim with LazyVim.

Each zsh file loads a matching `.local` file when it exists: `~/.zshenv.local`, `~/.zprofile.local` and `~/.zshrc.local`. Put machine-specific and work settings there. Git ignores them.

## Install

```sh
git clone https://github.com/frodsan/dotfiles ~/Code/frodsan/dotfiles && ~/Code/frodsan/dotfiles/install.sh
```

The repo is private, so `git clone` asks for your GitHub username and a personal access token.

`install.sh` does three things:

1. It installs Homebrew if `brew` is missing.
2. It installs the packages in `Brewfile` with `brew bundle`.
3. It links each path in its `FILES` list from the repo into your home folder.

When a path already exists in your home folder and isn't the link, the script renames it to `<name>.bak` and then creates the link. It never deletes files. You can run it again at any time.

## Add a file

1. Copy the file into the repo at the same path it has under your home folder.
2. Add that path to `FILES` in `install.sh`.
3. Run `./install.sh`.
