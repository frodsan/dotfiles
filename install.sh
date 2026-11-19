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
)

for file in "${FILES[@]}"; do
  source="$DOTFILES/$file"
  target="$HOME/$file"

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
