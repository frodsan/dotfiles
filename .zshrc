eval "$(jump shell zsh)"

autoload -Uz vcs_info
precmd() { vcs_info }

zstyle ':vcs_info:git:*' formats '%b '

setopt PROMPT_SUBST
PROMPT='%F{green}%*%f %F{blue}%~%f %F{red}${vcs_info_msg_0_}%f$ '

autoload -Uz compinit && compinit
if command -v wt >/dev/null 2>&1; then eval "$(command wt config shell init zsh)"; fi

HOMEBREW_PREFIX="${HOMEBREW_PREFIX:-/opt/homebrew}"

export PATH="${ASDF_DATA_DIR:-$HOME/.asdf}/shims:$PATH"
export PATH="$HOMEBREW_PREFIX/opt/findutils/libexec/gnubin:$PATH"
export PATH="$HOMEBREW_PREFIX/opt/gnu-sed/libexec/gnubin:$PATH"
export PATH="$HOMEBREW_PREFIX/opt/coreutils/libexec/gnubin:$PATH"
export PATH="$HOME/.local/bin:$PATH"

if [ -f "$HOME/.zshrc.local" ]; then
  . "$HOME/.zshrc.local"
fi
