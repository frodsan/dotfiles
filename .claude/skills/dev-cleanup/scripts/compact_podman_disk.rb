require "open3"

class CompactPodmanDisk
  DIR = File.expand_path("~/.local/share/containers/podman/machine/libkrun")
  DISK = File.join(DIR, "podman-machine-default-arm64.raw")
  COMPACT = File.join(DIR, "compact.raw")
  BACKUP = File.join(DIR, "backup.raw")

  def call
    abort "#{BACKUP} exists. Delete it or restore it first." if File.exist?(BACKUP)
    abort "#{COMPACT} exists. Delete it first." if File.exist?(COMPACT)

    puts "Disk file before: #{allocated(DISK)}"
    running = capture("podman", "ps", "-q").split

    step("Stopping containers") { run("podman", "stop", "-a") }
    step("Zeroing free space in the VM, the 'No space left' error is expected") do
      system("podman", "machine", "ssh", "sudo dd if=/dev/zero of=/var/zero.fill bs=4M status=none; sync; sudo rm -f /var/zero.fill; sync")
    end
    step("Stopping the machine") { run("podman", "machine", "stop") }
    step("Writing a sparse copy, about 4 minutes") do
      run("/bin/dd", "if=#{DISK}", "of=#{COMPACT}", "bs=1m", "conv=sparse")
      File.rename(DISK, BACKUP)
      File.rename(COMPACT, DISK)
    end
    step("Starting the machine") { run("podman", "machine", "start") }
    step("Starting the containers that were running") { run("podman", "start", *running) } if running.any?

    puts "Disk file after: #{allocated(DISK)}"
    puts "Check that your containers work, then delete #{BACKUP}"
  end

  private

  def step(label)
    puts "==> #{label}"
    yield
  end

  def run(*command)
    system(*command) || abort("Failed: #{command.join(' ')}")
  end

  def capture(*command)
    out, = Open3.capture3(*command)
    out
  end

  def allocated(path)
    capture("du", "-sh", path).split.first
  end
end

CompactPodmanDisk.new.call if $PROGRAM_NAME == __FILE__
