export LC_ALL=en_US.UTF-8
export LANG=en_US.UTF-8

source ~/.bashrc

# Load Rbenv
eval "$(rbenv init -)"

# Load AutoJump
[ -f /usr/local/etc/profile.d/autojump.sh ] && . /usr/local/etc/profile.d/autojump.sh

# The next line updates PATH for the Google Cloud SDK.
if [ -f '/Users/frodsan/google-cloud-sdk/path.bash.inc' ]; then source '/Users/frodsan/google-cloud-sdk/path.bash.inc'; fi

# The next line enables shell command completion for gcloud.
if [ -f '/Users/frodsan/google-cloud-sdk/completion.bash.inc' ]; then source '/Users/frodsan/google-cloud-sdk/completion.bash.inc'; fi
