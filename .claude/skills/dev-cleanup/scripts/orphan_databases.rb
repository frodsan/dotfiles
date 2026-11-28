require "open3"
require "set"

class OrphanDatabases
  POSTGRES_NAME_LIMIT = 63

  def self.sanitize(branch)
    branch.downcase.gsub(/[^a-z0-9_-]+/, "-").squeeze("-").delete_prefix("-").delete_suffix("-").tr("-", "_")
  end

  def call
    suffixes = worktree_branches.map { self.class.sanitize(_1) }
    branch_databases.reject do |database|
      prefix = database.split("__", 2).first
      suffixes.any? { "#{prefix}__#{_1}"[0, POSTGRES_NAME_LIMIT] == database }
    end
  end

  private

  def worktree_branches
    Dir.glob(File.expand_path("~/Code/*/*/.git")).select { File.directory?(_1) }.flat_map do |git_dir|
      out, = Open3.capture3("git", "-C", File.dirname(git_dir), "worktree", "list", "--porcelain")
      out.lines(chomp: true).filter_map { _1[%r{\Abranch refs/heads/(.+)}, 1] }
    end.to_set
  end

  def branch_databases
    out, err, status = Open3.capture3(
      "psql", "-X", "-At", "-d", "postgres",
      "-c", "SELECT datname FROM pg_database WHERE datname LIKE '%\\_\\_%' ORDER BY 1",
    )
    abort(err) unless status.success?
    out.lines(chomp: true)
  end
end

puts OrphanDatabases.new.call if $PROGRAM_NAME == __FILE__
