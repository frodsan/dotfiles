export LC_ALL=en_US.UTF-8
export LANG=en_US.UTF-8
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES

source ~/.bashrc

eval "$(/opt/homebrew/bin/brew shellenv)"

# Load AutoJump
[ -f /opt/homebrew/etc/profile.d/autojump.sh ] && . /opt/homebrew/etc/profile.d/autojump.sh

# Load asdf
. /opt/homebrew/opt/asdf/libexec/asdf.sh

source ~/.bashrc.local

