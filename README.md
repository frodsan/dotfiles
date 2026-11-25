# dotfiles

My macOS config.

## Set up

1. Run the installer. Confirm the Xcode Command Line Tools dialog if macOS shows one.

   ```sh
   curl -fsSL https://raw.githubusercontent.com/frodsan/dotfiles/master/install.sh | bash
   ```

   To replace files that already exist, add `-s -- --force`. Each one moves to `<name>.bak` first.

2. Put machine-specific and work settings in `~/.zshenv.local`, `~/.zprofile.local` and `~/.zshrc.local`. The installer creates them empty.
3. Put work rules for Claude Code in `~/Code/<company>/CLAUDE.local.md`.
4. In Herdr, open the custom settings with `⇧⌘,`. Add your commands.
