#!/usr/bin/env sh

cmd=$1

if [[ $cmd = "init" ]]; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> /Users/frodriguez/.bash_profile
  eval "$(/opt/homebrew/bin/brew shellenv)"
  brew update
  brew tap Homebrew/bundle
  brew bundle
elif [[ $cmd = "dump" ]]; then
  brew bundle dump --force
elif [[ $cmd = "install" ]]; then
  brew bundle
else
  echo "brew.sh <init|dump|install>"
  exit 1
fi
