export LC_ALL=en_US.UTF-8
export LANG=en_US.UTF-8

source ~/.bashrc

# Load Rbenv
eval "$(rbenv init -)"

# Load hub
eval "$(hub alias -s)"

# Load AutoJump
[ -f /usr/local/etc/profile.d/autojump.sh ] && . /usr/local/etc/profile.d/autojump.sh

# The next line updates PATH for the Google Cloud SDK.
if [ -f '/Users/frodsan/google-cloud-sdk/path.bash.inc' ]; then source '/Users/frodsan/google-cloud-sdk/path.bash.inc'; fi

# The next line enables shell command completion for gcloud.
if [ -f '/Users/frodsan/google-cloud-sdk/completion.bash.inc' ]; then source '/Users/frodsan/google-cloud-sdk/completion.bash.inc'; fi

JAVA_HOME=/Library/Java/JavaVirtualMachines/jdk-11.0.12.jdk/Contents/Home/
export JAVA_HOME

M2_HOME=/usr/local/Cellar/maven/3.8.2/libexec
export M2_HOME

PATH=$PATH:$JAVA_HOME/bin:$M2_HOME/bin
export PATH
