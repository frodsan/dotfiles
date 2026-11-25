import { View, div } from "gpui-kit";
import { exec, run, shared, notify, nextCommand, spaces, panes, home } from "herdr";

function currentFolder() {
  const space = spaces().find((s) => s.active);
  const tabs = new Set((space?.tabs ?? []).map((t) => t.id));
  const ps = panes().filter((p) => tabs.has(p.tab) && p.cwd);
  return (ps.find((p) => p.focused) ?? ps[0])?.cwd || space?.folder || home();
}

async function start(entry) {
  if (!entry?.command?.trim()) return notify({ title: `${entry?.title || "This command"} has no command`, body: "Open Firehouse settings (⇧⌘,) and fill it in under Commands.", level: "warning" });
  const shell = await exec("sh", ["-c", 'dscl . -read "/Users/$USER" UserShell 2>/dev/null | awk \'{print $2}\'']).catch(() => null);
  run("terminal.open", { argv: [shell?.stdout.trim() || "/bin/zsh", "-ilc", entry.command], folder: currentFolder(), place: "right" });
}

export default class CustomCommands extends View {
  init(_props, cx) {
    cx.spawn(async () => {
      for (;;) {
        const command = await nextCommand();
        if (command.startsWith("run-")) await start((shared("firehouse.settings")?.commands ?? []).find((c) => c.id === command.slice(4)));
      }
    });
  }

  render() {
    return div();
  }
}
