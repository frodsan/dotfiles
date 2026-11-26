import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, shared, setShared, props, closeOverlay, openOverlay } from "herdr";

const DEFAULT_SETTINGS = { settledDays: 7, branchPrefix: "", setup: {}, autoSettle: true, focusMute: false, focusWorking: true, tomorrowHour: 9, nextWeekDay: 1, autoToasts: false };
export const conf = () => ({ ...DEFAULT_SETTINGS, ...(shared("firehouse.settings") ?? {}) });
export const setConf = (change) => setShared("firehouse.settings", { ...(shared("firehouse.settings") ?? {}), ...change });
export const openSettings = () => openOverlay({ mod: "sessions", kind: "dialog", width: 620, height: 620, props: { settings: true } });
const SETTLED_DAYS = [1, 3, 7, 14, 30];

export class SettingsDialog {
  init() {
    const state = InputState.new({ value: conf().branchPrefix ?? "", placeholder: "e.g. fr/" });
    state.on("change", () => setConf({ branchPrefix: state.value().trim() }));
    this.branchPrefix = state;
  }

  render() {
    const t = theme();
    const c = conf();
    const choice = (id, label, on, onClick) => div().id(id).px(10).py(5).rounded(7).text_size(12.5).cursor_pointer()
      .when(on, (el) => el.bg(t.selected).text_color(t.foreground)).when(!on, (el) => el.text_color(t.muted).hover((st) => st.bg(t.hover).text_color(t.foreground)))
      .on_click((_e, cx) => { onClick(cx); cx.notify(); }).child(label);
    const chips = (key, options) => h_flex().gap(4).flex_wrap().children(options.map(([value, label]) => choice(`${key}-${value}`, label, c[key] === value, () => setConf({ [key]: value }))));
    const input = (state) => Input.new(state).h(28).px(8).rounded(6).border_1().border_color(t.input).bg(t.background).text_size(12.5).text_color(t.foreground);
    const row = (label, hint, control) => v_flex().gap(6)
      .child(div().text_size(12.5).font_medium().child(label))
      .child(control)
      .when(Boolean(hint), (el) => el.child(div().text_size(11.5).text_color(t.dim).child(hint ?? "")));
    const group = (title, ...rows) => v_flex().gap(10)
      .child(div().text_size(11).font_semibold().text_color(t.muted).child(title.toUpperCase()))
      .child(v_flex().gap(14).p(14).rounded(10).border_1().border_color(t.border).bg(t.background).children(rows));
    const onOff = (key) => chips(key, [[true, "On"], [false, "Off"]]);
    return v_flex().id("sessions-settings").size_full().min_h(0).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } })
      .child(h_flex().flex_none().px(22).pt(22).pb(12).items_center().child(div().flex_1().text_size(16).font_semibold().child("Session settings")).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(v_flex().id("settings-body").flex_1().min_h(0).px(22).pb(22).gap(20).overflow_y_scrollbar()
        .child(group("New sessions",
          row("Branch prefix", "New worktree branches start with this, e.g. fr/fix-login-1a2b.", input(this.branchPrefix)),
          div().text_size(11.5).text_color(t.dim).child("To run a setup command in new worktrees, right-click a folder in Sessions.")))
        .child(group("Settling",
          row("Auto-settle", "Settle a session when its pull request merges or closes. You can still turn it off per session.", onOff("autoSettle")),
          row("Keep settled sessions and archived chats for", "After that, Herdr deletes a settled session's worktree and Claude conversation. A worktree with uncommitted changes or commits that are not on GitHub stays, with a warning in Settled. The branch always stays. An archived chat moves to the Trash.", h_flex().gap(4).children(SETTLED_DAYS.map((d) => choice(`settled-${d}`, d === 1 ? "1 day" : `${d} days`, c.settledDays === d, () => setConf({ settledDays: d })))))))
        .child(group("Focus mode",
          row("Mute sounds", "When on, blocked sessions you can see still make a sound.", onOff("focusMute")),
          row("Working group", "Shows the focus sessions where Claude is working in their own group.", onOff("focusWorking"))))
        .child(group("Snooze",
          row("Wake-up time for Tomorrow and Next week", null, chips("tomorrowHour", [7, 8, 9, 10].map((h) => [h, `${h}:00`]))),
          row("Next week starts on", null, chips("nextWeekDay", [[1, "Monday"], [2, "Tuesday"], [5, "Friday"]]))))
        .child(group("Notifications",
          row("Toasts for automatic actions", "Auto-fix, merge when ready, auto-settle, snooze wake-ups and spin-offs. Off: the sidebar shows the change, and Herdr still plays its sounds. Errors from things you click always show.", onOff("autoToasts")))));
  }
}
