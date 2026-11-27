import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { keys, theme, props, closeOverlay } from "herdr";

const KEY_MODIFIERS = { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘" };
function keyOf(action) {
  return keys().find((k) => k.action === action || k.action.startsWith(`${action}:`))?.keys ?? null;
}
function prettyKey(combo) {
  const parts = combo.split(" ")[0].split("-");
  const key = parts.pop();
  const mods = Object.keys(KEY_MODIFIERS).filter((m) => parts.includes(m)).map((m) => KEY_MODIFIERS[m]).join("");
  return mods + ({ up: "↑", down: "↓", left: "←", right: "→", enter: "↵", escape: "Esc", "/": "/", ",": "," }[key] ?? key.toUpperCase());
}
const keyLabel = (action) => (keyOf(action) ? prettyKey(keyOf(action)) : null);

export default class Shortcuts extends View {
  render() {
    const t = theme();
    const columns = [
      ["Sessions", [
        ["sessions.new-session", "New session"],
        ["sessions.prev", "Previous session"],
        ["sessions.next", "Next session"],
        ["sessions.focus", "Focus mode"],
        ["sessions.github", "Open the PR on GitHub"],
        ["sessions.dev", "Edit Herdr config with Claude"],
        ["sessions.shortcuts", "These shortcuts"],
      ]],
      ["Panels & tools", [
        ["sessions.files", "Files"],
        ["sessions.changes", "Changes"],
        ["sessions.pull-request", "Pull request"],
        ["sessions.rails", "Rails console"],
        ["sessions.chats", "Chats with Claude"],
        ["sessions.new-chat", "New chat"],
        ["sessions.reviews", "Reviews"],
      ]],
      ["From Herdr", [
        ["tab.new", "New terminal tab"],
        ["terminal.search", "Find in the terminal"],
        ["app.palette", "Command palette"],
        ["layout.toggle", "Show or hide the sidebar"],
        ["tab.close", "Close the tab"],
        ["app.settings", "Herdr settings"],
        ["sessions.settings", "Firehouse settings"],
        ["app.help", "All of Herdr's keys"],
      ]],
    ];
    const chip = (text) => div().flex_none().px(7).py(2).rounded(5).bg(t.raised).border_1().border_color(t.border).text_size(11.5).text_color(t.foreground).child(text);
    const line = (label, combo) => h_flex().h(30).gap(10).items_center().text_size(12.5)
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(label))
      .child(combo ? chip(combo) : div().flex_none().text_size(11.5).text_color(t.dim).child("no key"));
    const heading = (text) => div().pb(6).mb(4).border_b_1().border_color(t.border).text_size(11).font_medium().text_color(t.dim).child(text.toUpperCase());
    return v_flex().id("shortcuts").size_full().p(22).gap(18).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child("Keyboard shortcuts")).child(div().text_size(11).text_color(t.dim).child("Esc to close")))
      .child(h_flex().gap(28).items_start()
        .children(columns.map(([title, items]) => v_flex().flex_1().min_w(0)
          .child(heading(title))
          .children(items.map(([action, label]) => line(label, keyLabel(action)))))))
      .child(div().text_size(11.5).text_color(t.dim).child("Change any key in ~/.config/herdr-app/keys.json. This list follows it."));
  }
}
