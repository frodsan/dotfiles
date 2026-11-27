# dotfiles

## Keep work and secrets out

This repo is public. Everything in it, including commit messages, is published.

- Treat every project outside `~/Code/frodsan` as work. Never put anything from one in this repo: company, product, repo or service names, paths, hostnames, URLs, ticket IDs, branch names, people's names or code.
- Write examples with neutral placeholders, such as `~/Code/app`, `bin/setup` or `fr/fix-login`.
- Never commit a secret: tokens, API keys, passwords, SSH keys, cookies, `.env` files or anything copied from a credentials store. Read config files before you copy them in, because some hold tokens.
- Put machine-specific or work values in a local file outside the repo, such as `~/.zshenv.local`, `~/.zprofile.local`, `~/.zshrc.local` or `~/.config/worktrunk/config.local.toml`.
- Never add a screenshot of a window that shows work sessions, chats or terminals.
- Before each commit, read the diff for any of the above. If you find something, stop and ask.

## Add a file

1. Copy the file into the repo at the same path it has under the home folder.
2. Add that path to `FILES` in `install.sh`. A file that its app rewrites goes in `COPIES` instead. A Herdr mod folder goes in `SYNCS`, because Herdr reloads copied mods but not linked ones.
3. Run `./install.sh --links`.

## Change a Herdr mod

After you change a file in `.config/herdr-app/mods`, and after a pull that changes one, run `./install.sh --sync`. It copies the mods into `~/.config/herdr-app/mods`, and Herdr reloads them. Edit the mods only in the repo, because the sync overwrites the copies.

## Commit

Commit straight to master. Do not create branches.
