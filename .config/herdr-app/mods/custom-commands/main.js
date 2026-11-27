import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, shared, setShared, appHome, readTextFile, writeTextFile, checking, nextCommand, openOverlay, closeOverlay, props, theme } from "herdr";

const OLD = () => shared("firehouse.settings") ?? {};
const list = () => shared("commands.list") ?? OLD().commands ?? [];
const setList = (commands) => setShared("commands.list", commands);

function moveOldList() {
  const { commands, ...rest } = OLD();
  if (!commands) return;
  if (shared("commands.list") == null) setList(commands);
  setShared("firehouse.settings", rest);
}
const openEditor = () => openOverlay({ mod: "custom-commands", kind: "dialog", width: 620, height: 520, props: { editor: true } });

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
    if (props()?.editor) {
      this.commandFields = {};
      for (const command of list()) this.makeCommandFields(command);
      return;
    }
    if (checking()) return;
    moveOldList();
    let published = null;
    const sync = () => {
      const commands = list();
      const key = JSON.stringify(commands);
      if (key === published) return;
      published = key;
      publish(commands).catch(() => { published = null; });
    };
    sync();
    cx.timer.every(2000, () => sync());
    cx.spawn(async () => {
      for (;;) {
        if ((await nextCommand()) === "edit") openEditor();
      }
    });
  }

  makeCommandFields(command) {
    const field = (key, placeholder) => {
      const state = InputState.new({ value: command[key] ?? "", placeholder });
      state.on("change", () => this.updateCommand(command.id, { [key]: state.value() }));
      return state;
    };
    this.commandFields[command.id] = { title: field("title", "Title, e.g. Refresh login"), command: field("command", "Shell command, e.g. cd ~/Code/app && bin/login") };
  }

  updateCommand(id, change) {
    setList(list().map((c) => (c.id === id ? { ...c, ...change } : c)));
  }

  renderCommands(t, input, choice) {
    const commands = list();
    const add = () => {
      const command = { id: Math.random().toString(36).slice(2, 10), title: "", command: "" };
      this.makeCommandFields(command);
      setList([...commands, command]);
    };
    const remove = (id) => { delete this.commandFields[id]; setList(commands.filter((c) => c.id !== id)); };
    return v_flex().gap(10)
      .children(commands.filter((c) => this.commandFields[c.id]).map((c) => v_flex().gap(6).p(10).rounded(8).border_1().border_color(t.border)
        .child(h_flex().gap(6).items_center()
          .child(div().flex_1().child(input(this.commandFields[c.id].title)))
          .child(div().id(`command-remove-${c.id}`).flex_none().px(8).py(5).rounded(6).text_size(12).text_color(t.dim).cursor_pointer()
            .hover((st) => st.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => { remove(c.id); cx.notify(); }).child("Remove")))
        .child(input(this.commandFields[c.id].command))))
      .child(h_flex().child(choice("command-add", "Add command", false, add)));
  }

  renderEditor() {
    const t = theme();
    const choice = (id, label, on, onClick) => div().id(id).px(10).py(5).rounded(7).text_size(12.5).cursor_pointer()
      .when(on, (el) => el.bg(t.selected).text_color(t.foreground)).when(!on, (el) => el.text_color(t.muted).hover((st) => st.bg(t.hover).text_color(t.foreground)))
      .on_click((_e, cx) => { onClick(cx); cx.notify(); }).child(label);
    const input = (state) => Input.new(state).h(28).px(8).rounded(6).border_1().border_color(t.input).bg(t.background).text_size(12.5).text_color(t.foreground);
    return v_flex().id("custom-commands").size_full().min_h(0).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } })
      .child(h_flex().flex_none().px(22).pt(22).pb(6).items_center().child(div().flex_1().text_size(16).font_semibold().child("Custom commands")).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().flex_none().px(22).pb(12).text_size(11.5).text_color(t.dim).child("Each one shows in the command palette and opens a terminal on the right, in the folder of the focused terminal. Start it with cd to run it somewhere else. They stay on this machine."))
      .child(v_flex().id("custom-commands-body").flex_1().min_h(0).px(22).pb(22).overflow_y_scrollbar().child(this.renderCommands(t, input, choice)));
  }

  render() {
    if (props()?.editor) return this.renderEditor();
    return div();
  }
}
