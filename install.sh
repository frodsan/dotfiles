#!/usr/bin/env bash

set -euo pipefail

REPO_URL="https://github.com/frodsan/dotfiles.git"
CLONE_DIR="${DOTFILES_DIR:-$HOME/Code/frodsan/dotfiles}"
SCRIPT="${BASH_SOURCE[0]:-}"
DOTFILES=""
if [[ -n "$SCRIPT" && -f "$SCRIPT" ]]; then
  DOTFILES="$(cd "$(dirname "$SCRIPT")" && pwd)"
fi
FORCE="${FORCE:-0}"

FILES=(
  .bundle/config
  .claude/CLAUDE.md
  .claude/rules/ruby.md
  .claude/skills/herdr-app
  .config/herdr-app/keys.json
  .config/herdr-app/layouts/Firehouse.json
  .config/herdr-app/mods/sessions
  .config/herdr-app/mods/chats
  .config/herdr-app/mods/custom-commands
  .config/herdr-app/mods/custom-settings
  .config/herdr-app/mods/shortcuts
  .config/herdr-app/themes/firehouse.json
  .config/nvim
  .gemrc
  .gitconfig
  .gitignore
  .irbrc
  .psqlrc
  .railsrc
  .zprofile
  .zshenv
  .zshrc
)

COPIES=(
  .config/herdr-app/settings.json
)

usage() {
  echo "Usage: install.sh [--force]"
  echo
  echo "Run from curl, it installs the Xcode Command Line Tools, clones the repo into"
  echo "\$DOTFILES_DIR (default ~/Code/frodsan/dotfiles) and runs the clone's install.sh."
  echo "Installs Homebrew and the Brewfile packages, then links the dotfiles into \$HOME."
  echo "Existing files are left alone unless you pass --force or set FORCE=1."
  echo "With --force, each existing file is moved to <name>.bak before it is linked."
}

parse_args() {
  for arg in "$@"; do
    case "$arg" in
      --force) FORCE=1 ;;
      -h | --help) usage; exit 0 ;;
      *) echo "Unknown option: $arg"; usage; exit 1 ;;
    esac
  done
}

install_command_line_tools() {
  echo "==> Xcode Command Line Tools"

  if xcode-select -p >/dev/null 2>&1; then
    echo "  already installed"
    return
  fi

  echo "  installing: confirm the dialog that macOS shows"
  xcode-select --install >/dev/null 2>&1 || true
  until xcode-select -p >/dev/null 2>&1; do
    sleep 5
  done
  echo "  installed"
}

bootstrap() {
  install_command_line_tools

  echo "==> Repo"
  mkdir -p "$(dirname "$CLONE_DIR")"

  if [[ -d "$CLONE_DIR/.git" ]]; then
    echo "  updating $CLONE_DIR"
    git -C "$CLONE_DIR" pull --ff-only
  elif [[ -e "$CLONE_DIR" ]]; then
    echo "  $CLONE_DIR exists and is not a git clone. Move it away, or set DOTFILES_DIR."
    exit 1
  else
    echo "  cloning into $CLONE_DIR"
    git clone "$REPO_URL" "$CLONE_DIR"
  fi

  exec bash "$CLONE_DIR/install.sh" "$@"
}

install_homebrew() {
  echo "==> Homebrew"

  if command -v brew >/dev/null; then
    echo "  already installed"
    return
  fi

  echo "  installing"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$(/opt/homebrew/bin/brew shellenv)"
}

install_packages() {
  echo "==> Brewfile packages"
  echo "  installing missing packages, without upgrading installed ones"
  brew bundle --no-upgrade --file="$DOTFILES/Brewfile"
}

same_content() {
  diff -rq "$1" "$2" >/dev/null 2>&1
}

link_file() {
  local file="$1"
  local source="$DOTFILES/$file"
  local target="$HOME/$file"

  if [[ -L "$target" && "$(readlink "$target")" == "$source" ]]; then
    echo "  ok       ~/$file is already linked"
    return
  fi

  if [[ -e "$target" || -L "$target" ]]; then
    local state="differs from the repo"
    if same_content "$source" "$target"; then
      state="has the same content as the repo"
    fi

    if [[ "$FORCE" != "1" ]]; then
      echo "  skipped  ~/$file exists and $state. Run with --force to replace it."
      SKIPPED=$((SKIPPED + 1))
      return
    fi

    local backup="$target.bak"
    if [[ -e "$backup" || -L "$backup" ]]; then
      backup="$target.bak.$(date +%Y%m%d%H%M%S)"
    fi

    mv "$target" "$backup"
    echo "  moved    ~/$file to ${backup/#$HOME/~}, it $state"
  fi

  mkdir -p "$(dirname "$target")"
  ln -s "$source" "$target"
  echo "  linked   ~/$file -> $source"
}

copy_file() {
  local file="$1"
  local source="$DOTFILES/$file"
  local target="$HOME/$file"

  if [[ -e "$target" || -L "$target" ]]; then
    echo "  ok       ~/$file exists, the app owns it now"
    return
  fi

  mkdir -p "$(dirname "$target")"
  cp "$source" "$target"
  echo "  copied   ~/$file"
}

link_files() {
  echo "==> Dotfiles"
  SKIPPED=0

  for file in "${FILES[@]}"; do
    link_file "$file"
  done

  for file in "${COPIES[@]}"; do
    copy_file "$file"
  done

  if [[ "$SKIPPED" -gt 0 ]]; then
    echo
    echo "$SKIPPED file(s) skipped. Compare them with the repo, then run install.sh --force."
  fi
}

select_herdr_layout() {
  echo "==> Herdr layout"
  local state="$HOME/.config/herdr-app/shared.json"

  if [[ ! -e "$state" ]]; then
    mkdir -p "$(dirname "$state")"
    printf '{\n  "layout": "Firehouse"\n}\n' >"$state"
    echo "  set      Firehouse for the first start"
  elif grep -q '"layout": *"Firehouse"' "$state"; then
    echo "  ok       Firehouse is the layout"
  elif command -v herdr-app >/dev/null && herdr-app do layout.switch --name Firehouse >/dev/null 2>&1; then
    echo "  switched to Firehouse"
  else
    echo "  skipped  Herdr is not running. Open it and run install.sh again."
  fi
}

install_skills() {
  echo "==> Agent skills"

  if ! command -v npx >/dev/null; then
    echo "  skipped  npx is missing. Install Node.js 22.20 or later, then run install.sh again."
    return
  fi

  local source skill
  while read -r source || [[ -n "$source" ]]; do
    [[ -z "$source" || "$source" == \#* ]] && continue
    skill="${source##*@}"

    if [[ -e "$HOME/.claude/skills/$skill" ]]; then
      echo "  ok       $skill is already installed"
      continue
    fi

    npx --yes skills add "$source" -g -a claude-code -y </dev/null
    echo "  added    $skill from ${source%@*}"
  done <"$DOTFILES/SKILLS"
}

parse_args "$@"
if [[ -z "$DOTFILES" || ! -f "$DOTFILES/Brewfile" ]]; then
  bootstrap "$@"
  exit
fi
install_homebrew
install_packages
link_files
select_herdr_layout
install_skills
