#!/usr/bin/env sh

BLACKLIST=".
..
.git
"

for file in .*; do
  if ! [[ $BLACKLIST =~ $file ]]; then
    rm -rf $HOME/$file
    ln -s $PWD/$file $HOME/$file
  fi
done
