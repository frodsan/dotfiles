#!/usr/bin/env sh

if [[ ! -d "$HOME/Library/Application Support/Code" ]]; then
  mkdir -p "$HOME/Library/Application Support/Code"
fi

if [[ ! -d "$HOME/Library/Application Support/Code/User" ]]; then
  mkdir -p "$HOME/Library/Application Support/Code/User"
fi

ln -s "$PWD/vscode/settings.json" "$HOME/Library/Application Support/Code/User/settings.json"

VSCODE_EXTENSIONS=(
  zhuangtongfa.material-theme
  PKief.material-icon-theme
)

for EXTENSION in ${VSCODE_EXTENSIONS[@]}; do
  code --install-extension $EXTENSION
done
