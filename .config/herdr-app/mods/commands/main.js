import { View, div } from "gpui-kit";
import { exec, run, shared, notify, nextCommand, spaces, panes } from "herdr";

const conf = () => shared("firehouse.settings") ?? {};
const BUILT_IN = { mcp: { title: "MCP servers", command: "claude /mcp", where: "repo" } };

function folderFor(where) {
  if (where === "session") {
    const space = spaces().find((s) => s.active);
    const tabs = new Set((space?.tabs ?? []).map((t) => t.id));
    const ps = panes().filter((p) => tabs.has(p.tab) && p.cwd);
    return (ps.find((p) => p.focused) ?? ps[0])?.cwd || space?.folder || null;
  }
  return conf().mainRepo || null;
}

async function start(entry) {
  if (!entry?.command?.trim()) return notify({ title: `${entry?.title || "This command"} has no command`, body: "Open Firehouse settings (⇧⌘,) and fill it in under Commands.", level: "warning" });
  const folder = folderFor(entry.where);
  if (!folder) {
    const body = entry.where === "session" ? "Open a session first." : "Open Firehouse settings (⇧⌘,) and pick your main repo.";
    return notify({ title: `No folder to run ${entry.title || "this command"} in`, body, level: "warning" });
  }
  const shell = await exec("sh", ["-c", 'dscl . -read "/Users/$USER" UserShell 2>/dev/null | awk \'{print $2}\'']).catch(() => null);
  run("terminal.open", { argv: [shell?.stdout.trim() || "/bin/zsh", "-ilc", entry.command], folder, place: "right" });
}

export default class Commands extends View {
  init(_props, cx) {
    cx.spawn(async () => {
      for (;;) {
        const command = await nextCommand();
        if (BUILT_IN[command]) await start(BUILT_IN[command]);
        else if (command.startsWith("run-")) await start((conf().commands ?? []).find((c) => c.id === command.slice(4)));
      }
    });
  }

  render() {
    return div();
  }
}
