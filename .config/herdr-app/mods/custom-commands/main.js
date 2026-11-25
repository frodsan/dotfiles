import { View, div } from "gpui-kit";
import { exec, run, shared, notify, nextCommand, spaces, panes, home, appHome, readTextFile, writeTextFile, checking } from "herdr";

const LOCAL = () => `${appHome()}/mods/custom-commands-local`;
const list = () => shared("firehouse.settings")?.commands ?? [];

function currentFolder() {
  const space = spaces().find((s) => s.active);
  const tabs = new Set((space?.tabs ?? []).map((t) => t.id));
  const ps = panes().filter((p) => tabs.has(p.tab) && p.cwd);
  return (ps.find((p) => p.focused) ?? ps[0])?.cwd || space?.folder || home();
}

async function start(entry) {
  if (!entry?.command?.trim()) return notify({ title: `${entry?.title || "This command"} has no command`, body: "Open custom settings (⇧⌘,) and fill it in under Commands.", level: "warning" });
  const shell = await exec("sh", ["-c", 'dscl . -read "/Users/$USER" UserShell 2>/dev/null | awk \'{print $2}\'']).catch(() => null);
  run("terminal.open", { argv: [shell?.stdout.trim() || "/bin/zsh", "-ilc", entry.command], folder: currentFolder(), place: "right" });
}

async function writeFile(path, text) {
  const current = await readTextFile(path).catch(() => null);
  if (current !== text) await writeTextFile(path, text, current);
}

async function publish() {
  const palette = list()
    .filter((c) => c.title?.trim() && c.command?.trim())
    .map((c) => ({ title: c.title.trim(), command: `custom-commands.run-${c.id}`, group: "Commands", words: c.command }));
  await exec("mkdir", ["-p", LOCAL()]);
  await writeFile(`${LOCAL()}/mod.json`, `${JSON.stringify({ place: "none", title: "Custom commands on this machine", palette }, null, 2)}\n`);
  await writeFile(`${LOCAL()}/main.js`, 'import { View, div } from "gpui-kit";\n\nexport default class CustomCommandsLocal extends View {\n  render() {\n    return div();\n  }\n}\n');
}

export default class CustomCommands extends View {
  init(_props, cx) {
    if (checking()) return;
    this.published = null;
    const sync = () => {
      const key = JSON.stringify(list());
      if (key === this.published) return;
      this.published = key;
      publish().catch(() => { this.published = null; });
    };
    sync();
    cx.timer.every(2000, () => sync());
    cx.spawn(async () => {
      for (;;) {
        const command = await nextCommand();
        if (command.startsWith("run-")) await start(list().find((c) => c.id === command.slice(4)));
      }
    });
  }

  render() {
    return div();
  }
}
