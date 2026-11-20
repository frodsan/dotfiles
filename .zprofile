eval "$(/opt/homebrew/bin/brew shellenv)"

export PATH="$HOMEBREW_PREFIX/opt/grep/libexec/gnubin:$PATH"

if [ -f "$HOME/.zprofile.local" ]; then
  . "$HOME/.zprofile.local"
fi
