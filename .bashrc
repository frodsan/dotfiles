export ARCHFLAGS="-arch x86_64"
export BIN=/usr/local/bin
export EDITOR=vim
export PATH=/bin
export PATH=/sbin:$PATH
export PATH=/usr/bin:$PATH
export PATH=/usr/sbin:$PATH
export PATH=$BIN:$PATH
export PATH=/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH
export PATH=./node_modules/.bin:$PATH
export PATH=./bin:$PATH
export PS1='\W $ '

export CLICOLOR=1
export TERM=xterm-256color

# Prevent file overwrite on stdout redirection
# Use `>|` to force redirection to an existing file.
set -o noclobber

# Update window size after every command.
shopt -s checkwinsize

# Automatically trim long paths in the prompt.
PROMPT_DIRTRIM=2

# Perform file completion in a case insensitive fashion.
bind "set completion-ignore-case on"

# Treat hyphens and underscores as equivalent
bind "set completion-map-case on"

# Display matches for ambiguous patterns at first tab press
bind "set show-all-if-ambiguous on"

# Append to the history file, don't overwrite it.
shopt -s histappend

# Save multi-line commands as one command.
shopt -s cmdhist

# Record each line as it gets issued.
PROMPT_COMMAND='history -a'

# Huge history settings.
HISTSIZE=500000
HISTFILESIZE=100000

# Avoid duplicate entries.
HISTCONTROL="erasedups:ignoreboth"

# Don't record some commands.
export HISTIGNORE="&:[ ]*:exit:ls:bg:fg:history:clear"

# Useful timestamp format.
HISTTIMEFORMAT='%F %T '

# Enable incremental history search with up/down arrows.
bind '"\e[A": history-search-backward'
bind '"\e[B": history-search-forward'
bind '"\e[C": forward-char'
bind '"\e[D": backward-char'

# Prepend cd to directory names automatically.
shopt -s autocd 2> /dev/null

# Correct spelling errors during tab-completion.
shopt -s dirspell 2> /dev/null

# Correct spelling errors in arguments supplied to cd.
shopt -s cdspell 2> /dev/null

# This defines where cd looks for targets
# Add the directories you want to have fast access to, separated by colon
# Ex: CDPATH=".:~:~/projects" will look for targets in the current working
# directory, in home and in the ~/projects folder
CDPATH=".:~:~/Code"

# This allows you to bookmark your favorite places across the file system
# Define a variable containing a path and you will be able to cd into it
# regardless of the directory you're in
shopt -s cdable_vars

# ----------------------------------
# Shortcuts
# ----------------------------------

export code="$HOME/Code"
export dotfiles="$HOME/Code/frodsan/dotfiles"
export frodsan="$HOME/Code/frodsan"

# ----------------------------------
# Docker
# ----------------------------------

# Get container process
alias dps="docker ps"

# Get process included stop container
alias dpa="docker ps -a"

# Stop all containers
dstop() { docker stop $(docker ps -aq); }

# Remove all containers
drm() { docker rm $(docker ps -aq); }

# ----------------------------------
# Docker Compose
# ----------------------------------

# Build docker
alias dbuild="docker-compose build"

# Run docker
alias dup="docker-compose up"

# Run command
alias drun="docker-compose run"
