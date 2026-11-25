import { View, div } from "gpui-kit";
import { exec, shared, appHome, readTextFile, writeTextFile, checking } from "herdr";

const LOCAL = () => `${appHome()}/mods/custom-commands-local`;
const STUB = 'import { View, div } from "gpui-kit";\n\nexport default class CustomCommandsLocal extends View {\n  render() {\n    return div();\n  }\n}\n';

async function loginShell() {
  const r = await exec("sh", ["-c", 'dscl . -read "/Users/$USER" UserShell 2>/dev/null | awk \'{print $2}\'']).catch(() => null);
  return r?.stdout.trim() || "/bin/zsh";
}

async function writeFile(path, text) {
  const current = await readTextFile(path).catch(() => null);
  if (current !== text) await writeTextFile(path, text, current);
}

async function publish(commands) {
  const shell = await loginShell();
  const palette = commands
    .filter((c) => c.title?.trim() && c.command?.trim())
    .map((c) => ({ title: c.title.trim(), command: "terminal.open", args: { argv: [shell, "-ilc", c.command], place: "right", name: c.title.trim() }, group: "Commands", words: c.command }));
  await exec("mkdir", ["-p", LOCAL()]);
  await writeFile(`${LOCAL()}/mod.json`, `${JSON.stringify({ place: "none", title: "Custom commands on this machine", palette }, null, 2)}\n`);
  await writeFile(`${LOCAL()}/main.js`, STUB);
}

export default class CustomCommands extends View {
  init(_props, cx) {
    if (checking()) return;
    let published = null;
    const sync = () => {
      const commands = shared("firehouse.settings")?.commands ?? [];
      const key = JSON.stringify(commands);
      if (key === published) return;
      published = key;
      publish(commands).catch(() => { published = null; });
    };
    sync();
    cx.timer.every(2000, () => sync());
  }

  render() {
    return div();
  }
}
