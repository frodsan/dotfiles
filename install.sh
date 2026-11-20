#!/usr/bin/env bash

set -euo pipefail

DOTFILES="$(cd "$(dirname "$0")" && pwd)"

FILES=(
  .bundle/config
  .config/nvim
  .gemrc
  .gitconfig
  .gitignore
  .irbrc
  .psqlrc
  .railsrc
  .zprofile
  .zshenv
  .zshrc
)

install_homebrew() {
  if command -v brew >/dev/null; then
    return
  fi

  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$(/opt/homebrew/bin/brew shellenv)"
}

install_packages() {
  brew bundle --file="$DOTFILES/Brewfile"
}

link_files() {
  for file in "${FILES[@]}"; do
    local source="$DOTFILES/$file"
    local target="$HOME/$file"

    if [[ -L "$target" && "$(readlink "$target")" == "$source" ]]; then
      continue
    fi

    mkdir -p "$(dirname "$target")"

    if [[ -e "$target" || -L "$target" ]]; then
      mv "$target" "$target.bak"
      echo "Moved $target to $target.bak"
    fi

    ln -s "$source" "$target"
    echo "Linked $target"
  done
}

install_homebrew
install_packages
link_files
