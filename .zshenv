if [ -f "$HOME/.cargo/env" ]; then
  . "$HOME/.cargo/env"
fi

if [ -f "$HOME/.zshenv.local" ]; then
  . "$HOME/.zshenv.local"
fi
