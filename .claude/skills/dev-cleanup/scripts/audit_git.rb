require "json"
require "open3"

class AuditGit
  def self.discover_repos
    Dir.glob(File.expand_path("~/Code/*/*/.git")).select { File.directory?(_1) }.map { File.dirname(_1) }.sort
  end

  def self.session_dirs
    pids, = Open3.capture3("pgrep", "-x", "claude")
    pids.split.filter_map do |pid|
      out, = Open3.capture3("lsof", "-a", "-p", pid, "-d", "cwd", "-Fn")
      out.lines(chomp: true).find { _1.start_with?("n") }&.delete_prefix("n")
    end.uniq.sort
  end

  def initialize(repo_root, session_dirs)
    @repo_root = File.expand_path(repo_root)
    @session_dirs = session_dirs
  end

  def call
    {
      "kept_worktrees" => kept_worktrees.map { _1["dir"] },
      "worktrees_to_remove" => worktrees_to_remove,
      "stale_folders" => stale_folders,
      "branches" => branches,
    }
  end

  def empty?(result)
    result["worktrees_to_remove"].empty? && result["stale_folders"].empty? &&
      result["branches"].values_at("pushed", "merged", "needs_decision").all?(&:empty?)
  end

  private

  def git(*args, dir: @repo_root)
    out, _err, status = Open3.capture3("git", "-C", dir, *args)
    status.success? ? out : nil
  end

  def worktrees
    @worktrees ||= begin
      list = []
      git("worktree", "list", "--porcelain").each_line(chomp: true) do |line|
        case line
        when /\Aworktree (.+)/ then list << { "dir" => Regexp.last_match(1), "branch" => nil }
        when %r{\Abranch refs/heads/(.+)} then list.last["branch"] = Regexp.last_match(1)
        end
      end
      list
    end
  end

  def in_session?(worktree)
    @session_dirs.any? { _1 == worktree["dir"] || _1.start_with?("#{worktree['dir']}/") }
  end

  def kept_worktrees
    @kept_worktrees ||= [worktrees.first] + worktrees.drop(1).select { in_session?(_1) }
  end

  def worktrees_to_remove
    (worktrees - kept_worktrees).map do |worktree|
      status = git("status", "--porcelain", dir: worktree["dir"])
      worktree.merge(
        "missing" => status.nil?,
        "changed_files" => status ? status.lines.count { !_1.start_with?("??") } : 0,
        "untracked_files" => status ? status.lines.count { _1.start_with?("??") } : 0,
      )
    end
  end

  def stale_folders
    pattern = File.join(File.dirname(@repo_root), "#{File.basename(@repo_root)}.*")
    registered = worktrees.map { _1["dir"] }
    Dir.glob(pattern).select { File.file?(File.join(_1, ".git")) }.reject do |dir|
      registered.include?(dir) || File.directory?(File.read(File.join(dir, ".git"))[/gitdir: (.+)/, 1].to_s)
    end
  end

  def default_branch
    git("symbolic-ref", "--short", "refs/remotes/origin/HEAD")&.strip&.delete_prefix("origin/") ||
      %w[main master].find { git("rev-parse", "--verify", "--quiet", "refs/heads/#{_1}") }
  end

  def kept_branches
    [default_branch, *kept_worktrees.filter_map { _1["branch"] }].compact.uniq
  end

  def branches
    names = git("for-each-ref", "--format=%(refname:short)", "refs/heads").lines(chomp: true) - kept_branches
    result = { "kept" => kept_branches, "pushed" => [], "merged" => [], "needs_decision" => [] }
    names.each do |name|
      local_only = git("rev-list", "--count", "refs/heads/#{name}", "--not", "--remotes").to_i
      next result["pushed"] << name if local_only.zero?

      state = pull_request_state(name)
      next result["merged"] << name if state == "MERGED"

      result["needs_decision"] << {
        "branch" => name,
        "pull_request" => state,
        "local_only_commits" => local_only,
        "last_commit" => git("log", "-1", "--format=%cs", "refs/heads/#{name}").strip,
      }
    end
    result
  end

  def pull_request_state(branch)
    out, _err, status = Open3.capture3(
      "gh", "pr", "list", "--head", branch, "--state", "all", "--limit", "1",
      "--json", "state", "--jq", '.[0].state // "NONE"',
      chdir: @repo_root,
    )
    status.success? ? out.strip : "UNKNOWN"
  end
end

if $PROGRAM_NAME == __FILE__
  sessions = AuditGit.session_dirs
  repos = ARGV.any? ? ARGV.map { File.expand_path(_1) } : AuditGit.discover_repos
  report = repos.to_h do |repo|
    audit = AuditGit.new(repo, sessions)
    result = audit.call
    [repo, audit.empty?(result) ? "nothing to clean" : result]
  end
  puts JSON.pretty_generate("session_dirs" => sessions, "repos" => report)
end
