""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""
" Plugins
""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""

call plug#begin('~/.vim/bundle')

Plug 'ctrlpvim/ctrlp.vim'                     " Fuzzy file, buffer, mru, tag, etc finder
Plug 'ervandew/supertab'                      " Perform vim insert mode completions with <Tab>
Plug 'janko-m/vim-test'                       " Run your tests at the speed of thought
Plug 'mileszs/ack.vim'                        " Vim plugin for the Perl module / CLI script 'ack'
Plug 'ntpeters/vim-better-whitespace'         " Better whitespace highlighting for Vim
Plug 'skywind3000/asyncrun.vim'               " Run Async Shell Commands in Vim
Plug 'tomasr/molokai'                         " Molokai color scheme for Vim

call plug#end()

""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""
" Settings
""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""""

set autoindent                                " auto indent
set backspace=indent,eol,start                " intuitive backspacing
set cursorline                                " highlight current line
set encoding=utf-8                            " default encoding
set expandtab                                 " tabs are spaces
set fileencoding=utf-8                        " default file encoding
set foldenable                                " enable folding
set foldlevelstart=10                         " open most folds by default
set foldmethod=syntax                         " fold based on indent level
set foldnestmax=10                            " 10 nested fold max
set hidden                                    " handle multiple buffers better
set hlsearch                                  " highlight matches
set incsearch                                 " search as characters are entered
set laststatus=2                              " show the status line all the time
set lazyredraw                                " redraw only when we need to.
set nrformats=                                " treal all numbers as decimals
set nobackup                                  " don't make a backup before overwriting a file
set noswapfile                                " don't save swap files
set nowritebackup                             " no backup I said
set nowrap                                    " don't wrap lines
set number                                    " show line numbers
set ruler                                     " show cursor position
set scrolloff=3                               " show 3 lines of context around the cursor
set shell=$SHELL                              " default shell
set shiftwidth=2                              " global tab width
set showcmd                                   " show command in bottom bar
set showmatch                                 " highlight matching [{()}]
set showmode                                  " display the current mode
set softtabstop=2                             " number of spaces in tab when editing
set tabstop=2                                 " number of visual spaces per TAB
set visualbell                                " no beeping
set wildmenu                                  " visual autocomplete for command menu
set wildmode=list:longest                     " complete files like a shell


" turn on syntax highlighting
syntax enable

" set colorscheme
colorscheme molokai

" disable trailiging whitespace highlighting
autocmd VimEnter * DisableWhitespace

" strip all trailing whitespace on save
autocmd BufEnter * EnableStripWhitespaceOnSave

" configure quickfix window for async commands
augroup vimrc
  autocmd QuickFixCmdPost * botright copen 20
augroup END

nmap <F1> :call asyncrun#quickfix_toggle(20)<CR>

" set leader key
let mapleader = ','

" use the silver searcher instead of grep
if executable('ag')
  let g:ackprg = 'ag --vimgrep'
endif

" custom ctrlp settings
let g:ctrlp_match_window = "bottom,order:ttb"
let g:ctrlp_switch_buffer = 0
let g:ctrlp_user_command = 'ag %s -l --nocolor --hidden -g ""'
let g:ctrlp_working_path_mode = 0

" set vim-test mappings
nmap <silent> <leader>t :TestNearest<CR>
nmap <silent> <leader>T :TestFile<CR>
nmap <silent> <leader>r :TestLast<CR>
nmap <silent> <leader>R :TestSuite<CR>
nmap <silent> <leader>g :TestVisit<CR>

" run tests asynchronously
let test#strategy = 'asyncrun'
