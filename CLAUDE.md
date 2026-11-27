# dotfiles

## Add a file

1. Copy the file into the repo at the same path it has under the home folder.
2. Add that path to `FILES` in `install.sh`. A file that its app rewrites goes in `COPIES` instead. A Herdr mod folder goes in `SYNCS`, because Herdr reloads copied mods but not linked ones.
3. Run `./install.sh --links`.

## Commit

Commit straight to master. Do not create branches.

The git hooks in `.githooks` copy the Herdr mods into `~/.config/herdr-app/mods` after each commit, merge and checkout. Herdr loads a mod change only after you commit it.
