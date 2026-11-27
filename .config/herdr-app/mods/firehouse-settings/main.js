import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, shared, setShared, props, closeOverlay, exec } from "herdr";

const DEFAULTS = { settledDays: 7, branchPrefix: "", autoSettle: true, focusMute: false, focusWorking: true, tomorrowHour: 9, autoToasts: false, reviewsRefreshMinutes: 2, reviewsKeepDays: 1 };
const conf = () => ({ ...DEFAULTS, ...(shared("firehouse.settings") ?? {}) });
const setConf = (change) => setShared("firehouse.settings", { ...(shared("firehouse.settings") ?? {}), ...change });
const SETTLED_DAYS = [1, 3, 7, 14, 30];
const REFRESH_MINUTES = [1, 2, 5, 10];
const KEEP_DAYS = [1, 3, 7];

export default class Settings extends View {
  init(_props, cx) {
    this.rate = null;
    const load = async (cx) => {
      const r = await exec("gh", ["api", "rate_limit"]).catch(() => null);
      if (r?.code !== 0) return;
      try { this.rate = JSON.parse(r.stdout).resources; } catch { return; }
      cx.notify();
    };
    cx.spawn(async (cx) => load(cx));
    cx.timer.every(10000, (cx) => { load(cx); });
    const state = InputState.new({ value: conf().branchPrefix ?? "", placeholder: "e.g. fr/" });
    state.on("change", () => setConf({ branchPrefix: state.value().trim() }));
    this.branchPrefix = state;
  }

  rateRow(r, label, hint, row, t) {
    if (!r) return div();
    const share = r.limit ? Math.min(1, r.used / r.limit) : 0;
    const color = share > 0.9 ? t.blocked : share > 0.6 ? t.working : t.done;
    const reset = new Date(r.reset * 1000);
    const at = `${reset.getHours()}:${String(reset.getMinutes()).padStart(2, "0")}`;
    return row(`${label} · ${r.used.toLocaleString()} of ${r.limit.toLocaleString()} used`, `${hint} Resets at ${at}.`,
      div().w_full().h(6).rounded(3).bg(t.raised).child(div().h_full().rounded(3).bg(color).w(`${Math.max(2, Math.round(share * 100))}%`)));
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
    return v_flex().id("settings").size_full().min_h(0).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } })
      .child(h_flex().flex_none().px(22).pt(22).pb(12).items_center().child(div().flex_1().text_size(16).font_semibold().child("Firehouse settings")).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(v_flex().id("settings-body").flex_1().min_h(0).px(22).pb(22).gap(20).overflow_y_scrollbar()
        .child(group("New sessions",
          row("Branch prefix", "New worktree branches start with this, e.g. fr/fix-login-1a2b. To run a command in each new worktree, add a post-start hook to Worktrunk's config.", input(this.branchPrefix))))
        .child(group("Settling",
          row("Auto-settle", "Settle a session when its pull request merges or closes. You can still turn it off per session.", onOff("autoSettle")),
          row("Keep settled sessions and archived chats for", "After that, Herdr deletes a settled session's worktree, with any uncommitted changes, and its Claude conversation. The branch always stays, with its commits. An archived chat moves to the Trash.", h_flex().gap(4).children(SETTLED_DAYS.map((d) => choice(`settled-${d}`, d === 1 ? "1 day" : `${d} days`, c.settledDays === d, () => setConf({ settledDays: d })))))))
        .child(group("Focus mode",
          row("Mute sounds", "When on, blocked sessions you can see still make a sound.", onOff("focusMute")),
          row("Working group", "Shows the focus sessions where Claude is working in their own group.", onOff("focusWorking"))))
        .child(group("Snooze",
          row("Wake-up time for Tomorrow and Next week", "Next week is the coming Monday.", chips("tomorrowHour", [7, 8, 9, 10].map((h) => [h, `${h}:00`])))))
        .child(group("Reviews",
          row("Refresh the list every", "How often Herdr asks GitHub for the pull requests that list you as a reviewer. Refresh in the list asks right away.", chips("reviewsRefreshMinutes", REFRESH_MINUTES.map((m) => [m, m === 1 ? "1 minute" : `${m} minutes`]))),
          row("Keep recently reviewed for", "Pull requests you approved, or that merged, closed or stopped asking you, stay under Recently reviewed this long.", chips("reviewsKeepDays", KEEP_DAYS.map((d) => [d, d === 1 ? "1 day" : `${d} days`])))))
        .child(group("Notifications",
          row("Toasts for automatic actions", "Auto-fix, merge when ready, auto-settle, snooze wake-ups and spin-offs. Off: the sidebar shows the change, and Herdr still plays its sounds. Errors from things you click always show.", onOff("autoToasts"))))
        .child(group("GitHub API",
          ...(this.rate
            ? [["graphql", "GraphQL", "The pull request list, the pull request panel and auto-fix. When fewer than 500 are left, the list refreshes every 30 seconds, and below 100 every 2 minutes."], ["core", "REST", "Most other gh commands."], ["search", "Search", "The reviews list."]]
                .map(([key, label, hint]) => this.rateRow(this.rate[key], label, hint, row, t))
            : [div().text_size(12).text_color(t.dim).child("Asking GitHub…")]))));
  }
}
