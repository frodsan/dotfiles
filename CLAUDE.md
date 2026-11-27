# dotfiles

## Add a file

1. Copy the file into the repo at the same path it has under the home folder.
2. Add that path to `FILES` in `install.sh`. A file that its app rewrites goes in `COPIES` instead. A Herdr mod folder goes in `SYNCS`, because Herdr reloads copied mods but not linked ones.
3. Run `./install.sh --links`.

## Change a Herdr mod

After you change a file in `.config/herdr-app/mods`, and after a pull that changes one, run `./install.sh --sync`. It copies the mods into `~/.config/herdr-app/mods`, and Herdr reloads them. Edit the mods only in the repo, because the sync overwrites the copies.

## Commit

Commit straight to master. Do not create branches.
