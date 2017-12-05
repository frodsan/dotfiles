#!/usr/bin/env sh

BLACKLIST=".
..
.git
vscode
"

for file in .*; do
  if ! [[ $BLACKLIST =~ $file ]]; then
    rm -rf $HOME/$file
    ln -s $PWD/$file $HOME/$file
  fi
done

# Setting VS Code

if [[ ! -d "$HOME/Library/Application Support/Code" ]]; then
  mkdir -p "$HOME/Library/Application Support/Code"
fi

if [[ ! -d "$HOME/Library/Application Support/Code/User" ]]; then
  mkdir -p "$HOME/Library/Application Support/Code/User"
fi

ln -s "$PWD/vscode/settings.json" "$HOME/Library/Application Support/Code/User/settings.json"

VSCODE_EXTENSIONS=(
)

for EXTENSION in ${VSCODE_EXTENSIONS[@]}; do
  code --install-extension $EXTENSION
done