import { View, div } from "gpui-kit";
import { exec, run, shared, notify, nextCommand } from "herdr";

const conf = () => shared("firehouse.settings") ?? {};
const COMMANDS = { aws: () => conf().awsCommand, mcp: () => conf().mcpCommand || "claude /mcp" };

async function open(kind) {
  if (!COMMANDS[kind]()) return notify({ title: "Set the AWS login command first", body: "Open Firehouse settings (⇧⌘,) and fill in AWS login command.", level: "warning" });
  const folder = conf().mainRepo;
  if (!folder) return notify({ title: "Choose your main repo first", body: "Open Firehouse settings (⇧⌘,) and pick the repo these tools run in.", level: "warning" });
  const shell = await exec("sh", ["-c", 'dscl . -read "/Users/$USER" UserShell 2>/dev/null | awk \'{print $2}\'']).catch(() => null);
  run("terminal.open", { argv: [shell?.stdout.trim() || "/bin/zsh", "-ilc", COMMANDS[kind]()], folder, place: "right" });
}

export default class WorkTools extends View {
  init(_props, cx) {
    cx.spawn(async () => {
      for (;;) {
        const command = await nextCommand();
        if (COMMANDS[command]) await open(command);
      }
    });
  }

  render() {
    return div();
  }
}
