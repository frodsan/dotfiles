#!/usr/bin/env sh

cmd=$1

if [[ $cmd = "init" ]]; then
  /usr/bin/ruby -e "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install)"

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
