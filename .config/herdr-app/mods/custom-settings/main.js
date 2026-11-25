import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, shared, setShared, props, closeOverlay, openOverlay } from "herdr";

const PR_FRESH_MS = 5000;
const conf = () => ({ ...(shared("settings.defaults") ?? {}), ...(shared("firehouse.settings") ?? {}) });
const setConf = (change) => setShared("firehouse.settings", { ...(shared("firehouse.settings") ?? {}), ...change });
const SETTLED_DAYS = [1, 3, 7, 14, 30];
const prInterval = () => {
  const rate = shared("github.rateLimit");
  if (!rate || Date.parse(rate.resetAt) < Date.now()) return PR_FRESH_MS;
  return rate.remaining < 100 ? 120000 : rate.remaining < 500 ? 30000 : PR_FRESH_MS;
};

export default class CustomSettings extends View {
  init() {
    const c = conf();
    const field = (key, placeholder) => {
      const state = InputState.new({ value: c[key] ?? "", placeholder });
      state.on("change", () => setConf({ [key]: state.value().trim() }));
      return state;
    };
    this.fields = {
      branchPrefix: field("branchPrefix", "e.g. fr/"),
      reviewBot: field("reviewBot", "e.g. review-bot"),
    };
  }

  renderRate() {
    const t = theme();
    const rate = shared("github.rateLimit");
    if (!rate) return div().text_size(12.5).text_color(t.dim).child("No data yet.");
    const reset = new Date(rate.resetAt);
    const pct = Math.min(1, rate.used / rate.limit);
    const every = prInterval() / 1000;
    return v_flex().gap(6)
      .child(h_flex().gap(8).items_center().text_size(12.5)
        .child(div().child(`${rate.used.toLocaleString()} of ${rate.limit.toLocaleString()} points used`))
        .child(div().text_color(t.dim).child(`· resets at ${String(reset.getHours()).padStart(2, "0")}:${String(reset.getMinutes()).padStart(2, "0")} · PR status every ${every < 60 ? `${every} s` : `${every / 60} min`}`)))
      .child(div().h(6).w_full().rounded(3).bg(t.raised)
        .child(div().h_full().rounded(3).w(`${Math.round(pct * 100)}%`).bg(rate.remaining < 500 ? t.blocked : t.accent)));
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
    return v_flex().id("custom-settings").size_full().min_h(0).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } })
      .child(h_flex().flex_none().px(22).pt(22).pb(12).items_center().child(div().flex_1().text_size(16).font_semibold().child("Custom settings")).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(v_flex().id("settings-body").flex_1().min_h(0).px(22).pb(22).gap(20).overflow_y_scrollbar()
        .child(group("New sessions",
          row("Branch prefix", "New worktree branches start with this, e.g. fr/fix-login-1a2b.", input(this.fields.branchPrefix)),
          row("Branch names come from", "Claude asks Haiku for a short slug. Message words uses the first words you type.", chips("branchNames", [["claude", "Claude"], ["words", "Message words"]])),
          div().text_size(11.5).text_color(t.dim).child("To run a setup command in new worktrees, right-click a folder in Sessions.")))
        .child(group("Pull requests",
          row("GitHub API", "Herdr checks the PR of every session in one query. It slows down to every 30 seconds when fewer than 500 points are left, and to every 2 minutes below 100. The budget is shared with everything that uses your gh login, including Claude.", this.renderRate()),
          row("Mark drafts ready for review", "When a draft's required checks pass, the review bot reviewed it, and every thread is resolved, Herdr marks it ready for review. Turn it off for one session from its right-click menu.", chips("autoReady", [[true, "On"], [false, "Off"]])),
          row("Mark ready from", null, chips("readyFrom", [6, 7, 8, 9, 10].map((h) => [h, `${h}:00`]))),
          row("Mark ready until", "Outside these hours, drafts stay drafts. Herdr marks them ready at the next start time.", chips("readyUntil", [16, 17, 18, 19, 20].map((h) => [h, `${h}:00`]))),
          row("Review bot", "Part of the GitHub login of the bot that reviews your pull requests. Auto-fix treats its comments as bot comments, and Ready for review waits for its review. Empty means no bot.", input(this.fields.reviewBot))))
        .child(group("Settling",
          row("Auto-settle", "Settle a session when its pull request merges or closes. You can still turn it off per session.", onOff("autoSettle")),
          row("Keep settled sessions for", "After that, Herdr deletes its worktree and Claude conversation. A worktree with uncommitted changes or commits that are not on GitHub stays, with a warning in Settled. The branch always stays.", h_flex().gap(4).children(SETTLED_DAYS.map((d) => choice(`settled-${d}`, d === 1 ? "1 day" : `${d} days`, c.settledDays === d, () => setConf({ settledDays: d })))))))
        .child(group("Focus mode",
          row("Mute sounds", "When on, blocked sessions you can see still make a sound.", h_flex().gap(4).children([[true, "On"], [false, "Off"]].map(([value, text]) => choice(`focusMute-${value}`, text, c.focusMute === value, () => { setConf({ focusMute: value }); })))),
          row("Working group", "Shows the focus sessions where Claude is working in their own group.", onOff("focusWorking")),
))
        .child(group("Snooze",
          row("Wake-up time for Tomorrow and Next week", null, chips("tomorrowHour", [7, 8, 9, 10].map((h) => [h, `${h}:00`]))),
          row("Next week starts on", null, chips("nextWeekDay", [[1, "Monday"], [2, "Tuesday"], [5, "Friday"]]))))
        .child(group("Notifications",
          row("Toasts for automatic actions", "Auto-fix, merge when ready, auto-settle, snooze wake-ups and spin-offs. Off: the sidebar shows the change, and Herdr still plays its sounds. Errors from things you click always show.", chips("autoToasts", [[true, "On"], [false, "Off"]])))
        .child(group("Commands",
          row("Palette commands", "Your own commands in the command palette. They stay on this machine.", h_flex().child(choice("commands-edit", "Edit commands…", false, () => openOverlay({ mod: "custom-commands", kind: "dialog", width: 620, height: 520, props: { editor: true } })))))))
);
  }
}
