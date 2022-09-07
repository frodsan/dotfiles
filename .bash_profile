export LC_ALL=en_US.UTF-8
export LANG=en_US.UTF-8

source ~/.bashrc

eval "$(/opt/homebrew/bin/brew shellenv)"

# Load Rbenv
eval "$(rbenv init -)"

# Load hub
eval "$(hub alias -s)"

# Load AutoJump
[ -f /opt/homebrew/etc/profile.d/autojump.sh ] && . /opt/homebrew/etc/profile.d/autojump.sh
