import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, shared, setShared, props, closeOverlay, exec } from "herdr";

const DEFAULTS = { settledDays: 7, archivedDays: 7, branchPrefix: "", autoSettle: true, focusMute: false, focusWorking: true, tomorrowHour: 9, autoToasts: false, reviewsRefreshMinutes: 5, reviewsKeepDays: 1, reviewsDiffLayout: "split", quickModel: "haiku", quickEffort: "low" };
const conf = () => ({ ...DEFAULTS, ...(shared("firehouse.settings") ?? {}) });
const setConf = (change) => setShared("firehouse.settings", { ...(shared("firehouse.settings") ?? {}), ...change });
const SETTLED_DAYS = [1, 3, 7];
const REFRESH_MINUTES = [5, 10, 30, 60];
const KEEP_DAYS = [1, 3, 7];
const MINUTE = 60000;
const DAY = 86400000;
// Each duration setting: its key, the unit it's saved in, the shortest value allowed, and the chips.
const SPANS = {
  archivedDays: { unit: DAY, min: MINUTE, chips: SETTLED_DAYS },
  settledDays: { unit: DAY, min: MINUTE, chips: SETTLED_DAYS },
  reviewsRefreshMinutes: { unit: MINUTE, min: MINUTE, chips: REFRESH_MINUTES },
  reviewsKeepDays: { unit: DAY, min: MINUTE, chips: KEEP_DAYS },
};
const SPAN_UNITS = { w: 7 * DAY, d: DAY, h: 60 * MINUTE, m: MINUTE };
const parseSpan = (text) => {
  const value = text.trim().toLowerCase().replace(/\s+/g, "");
  if (!/^(\d+(\.\d+)?[wdhm])+$/.test(value)) return null;
  let ms = 0;
  for (const part of value.match(/\d+(\.\d+)?[wdhm]/g)) ms += parseFloat(part) * SPAN_UNITS[part[part.length - 1]];
  return ms;
};
const formatSpan = (ms) => {
  const parts = [];
  let left = Math.round(ms / MINUTE) * MINUTE;
  for (const unit of ["d", "h", "m"]) {
    const n = Math.floor(left / SPAN_UNITS[unit]);
    if (n) parts.push(n + unit);
    left -= n * SPAN_UNITS[unit];
  }
  return parts.join(" ") || "0m";
};

const USAGE_SCRIPT = 'PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"; find "$HOME/.claude/projects" -name "*.jsonl" -mtime -8 -print0 | xargs -0 grep -h output_tokens 2>/dev/null | jq -nc --arg today "$1" --arg week "$2" "$3"';
const USAGE_JQ = [
  'def add($a; $n): ($a // [0, 0, 0, 0, 0]) | [range(5) as $i | .[$i] + $n[$i]];',
  'reduce (inputs | select(.type == "assistant" and .message.usage and .message.model != "<synthetic>" and (.timestamp // "") >= $week)) as $m ({seen: {}, rows: {}};',
  '  if .seen[$m.message.id] then . else',
  '    .seen[$m.message.id] = true',
  '    | ($m.message.usage) as $u',
  '    | ($u.cache_creation.ephemeral_1h_input_tokens // 0) as $h',
  '    | [($u.input_tokens // 0), (($u.cache_creation_input_tokens // 0) - $h), $h, ($u.cache_read_input_tokens // 0), ($u.output_tokens // 0)] as $n',
  '    | ($m.message.model // "unknown") as $k',
  '    | .rows[$k].week = add(.rows[$k].week; $n)',
  '    | if $m.timestamp >= $today then .rows[$k].today = add(.rows[$k].today; $n) else . end',
  '  end) | .rows',
].join(" ");
const tokens = (n) => n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);
const modelName = (id) => { const m = id.match(/claude-([a-z]+)-(\d+)-(\d+)/); return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : id; };

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
    this.usage = null;
    const loadUsage = async (cx) => {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const week = new Date(Date.now() - 7 * 86400000);
      const r = await exec("sh", ["-c", USAGE_SCRIPT, "sh", today.toISOString(), week.toISOString(), USAGE_JQ]).catch(() => null);
      if (r?.code !== 0) { this.usage = this.usage ?? {}; cx.notify(); return; }
      try { this.usage = JSON.parse(r.stdout || "{}") ?? {}; } catch { this.usage = {}; }
      cx.notify();
    };
    cx.spawn(async (cx) => loadUsage(cx));
    cx.timer.every(60000, (cx) => { loadUsage(cx); });
    const state = InputState.new({ value: conf().branchPrefix ?? "", placeholder: "e.g. me/" });
    state.on("change", () => setConf({ branchPrefix: state.value().trim() }));
    this.branchPrefix = state;
    const hint = InputState.new({ value: conf().composerPlaceholder ?? "", placeholder: "What fire are we putting out first?" });
    hint.on("change", () => setConf({ composerPlaceholder: hint.value().trim() }));
    this.composerPlaceholder = hint;
    this.spans = {};
    this.spanBad = {};
    for (const key of Object.keys(SPANS)) {
      const span = SPANS[key];
      const current = conf()[key];
      const custom = span.chips.indexOf(current) === -1 ? formatSpan(current * span.unit) : "";
      const field = InputState.new({ value: custom, placeholder: "e.g. 5d or 12h" });
      field.on("change", (_e, cx) => {
        const text = field.value().trim();
        const ms = parseSpan(text);
        this.spanBad[key] = Boolean(text) && (ms == null || ms < span.min);
        if (!this.spanBad[key] && ms != null) setConf({ [key]: ms / span.unit });
        cx.notify();
      });
      this.spans[key] = field;
    }
  }

  spanControl(key, label, choice, t) {
    const span = SPANS[key];
    const current = conf()[key];
    const pick = (value) => { this.spans[key].set_value(""); this.spanBad[key] = false; setConf({ [key]: value }); };
    const chips = span.chips.map((n) => choice(key + "-" + n, label(n), current === n, () => pick(n)));
    const custom = span.chips.indexOf(current) === -1;
    const field = Input.new(this.spans[key]).w(120).h(28).px(8).rounded(6).border_1()
      .border_color(this.spanBad[key] ? t.blocked : custom ? t.accent : t.input)
      .bg(t.background).text_size(12.5).text_color(t.foreground);
    return h_flex().gap(4).flex_wrap().items_center().children(chips).child(div().w(6)).child(field);
  }

  usageRows(t) {
    const note = (text) => div().text_size(12).text_color(t.dim).child(text);
    if (this.usage == null) return [note("Reading Claude transcripts…")];
    const models = Object.keys(this.usage);
    if (models.length === 0) return [note("No Claude use in the last 7 days.")];
    const output = (id) => (this.usage[id].week ? this.usage[id].week[4] : 0);
    models.sort((a, b) => output(b) - output(a));
    const line = (id, label, v) => (v ? label + ": ↑ " + tokens(v[0] + v[1] + v[2] + v[3]) + "  ↓ " + tokens(v[4]) : label + ": none");
    const rows = [];
    for (const id of models) {
      rows.push(h_flex().gap(12).items_start()
        .child(div().w(90).flex_none().text_size(12.5).font_medium().child(modelName(id)))
        .child(v_flex().gap(2).flex_1().min_w(0).text_size(12).text_color(t.muted)
          .child(line(id, "Today", this.usage[id].today))
          .child(line(id, "Last 7 days", this.usage[id].week))));
    }
    rows.push(div().text_size(11.5).text_color(t.dim).child("From your Claude transcripts. ↑ input, cache included. ↓ output."));
    return rows;
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
    const days = (d) => (d === 1 ? "1 day" : d + " days");
    return v_flex().id("settings").size_full().min_h(0).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } })
      .child(h_flex().flex_none().px(22).pt(22).pb(12).items_center().child(div().flex_1().text_size(16).font_semibold().child("Firehouse settings")).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(v_flex().id("settings-body").flex_1().min_h(0).px(22).pb(22).gap(20).overflow_y_scrollbar()
        .child(group("Chats",
          row("Keep archived chats for", "After that, an archived chat's conversation moves to the Trash.", this.spanControl("archivedDays", days, choice, t))))
        .child(group("New sessions",
          row("Branch prefix", "New worktree branches start with this, e.g. me/fix-login-1a2b. To run a command in each new worktree, add a post-start hook to Worktrunk's config.", input(this.branchPrefix)),
          row("Prompt placeholder", "The gray text in an empty New session prompt. Leave it empty for the default.", input(this.composerPlaceholder))))
        .child(group("Settling",
          row("Auto-settle", "Settle a session when its pull request merges or closes. You can still turn it off per session.", onOff("autoSettle")),
          row("Keep settled sessions for", "After that, Herdr deletes a settled session's worktree, with any uncommitted changes, and its Claude conversation. The branch always stays, with its commits.", this.spanControl("settledDays", days, choice, t))))
        .child(group("Focus mode",
          row("Mute sounds", "When on, blocked sessions you can see still make a sound.", onOff("focusMute")),
          row("Working group", "Shows the focus sessions where Claude is working in their own group.", onOff("focusWorking"))))
        .child(group("Snooze",
          row("Wake-up time for Tomorrow and Next week", "Next week is the coming Monday.", chips("tomorrowHour", [6, 7, 8, 9, 10].map((h) => [h, `${h}:00`])))))
        .child(group("Reviews",
          row("Refresh the list every", "How often Herdr asks GitHub for the pull requests that list you as a reviewer. Refresh in the list asks right away.", this.spanControl("reviewsRefreshMinutes", (m) => (m === 1 ? "1 minute" : m + " minutes"), choice, t)),
          row("Keep recently reviewed for", "Pull requests you approved, or that merged, closed or stopped asking you, stay under Recently reviewed this long.", this.spanControl("reviewsKeepDays", days, choice, t)),
          row("Diff layout", "How Files changed shows diffs. The switch above the files changes it too.", chips("reviewsDiffLayout", [["split", "Split"], ["unified", "Unified"]]))))
        .child(group("Notifications",
          row("Toasts for automatic actions", "Auto-fix, merge when ready, auto-settle, snooze wake-ups and spin-offs. Off: the sidebar shows the change, and Herdr still plays its sounds. Errors from things you click always show.", onOff("autoToasts"))))
        .child(group("Text generation",
          row("Model", "Claude writes branch names for new sessions and titles for chats with this model.", chips("quickModel", [["haiku", "Haiku"], ["sonnet", "Sonnet"], ["opus", "Opus"], ["fable", "Fable"]])),
          row("Effort", "Default uses your Claude setting.", chips("quickEffort", [[null, "Default"], ["low", "Low"], ["medium", "Medium"], ["high", "High"], ["xhigh", "Extra high"], ["max", "Max"]]))))
        .child(group("GitHub API",
          ...(this.rate
            ? [["graphql", "GraphQL", "The pull request list, the pull request panel and auto-fix. When fewer than 500 are left, the list refreshes every 30 seconds, and below 100 every 2 minutes."], ["core", "REST", "Most other gh commands."], ["search", "Search", "The reviews list."]]
                .map(([key, label, hint]) => this.rateRow(this.rate[key], label, hint, row, t))
            : [div().text_size(12).text_color(t.dim).child("Asking GitHub…")])))
        .child(group("Claude usage", ...this.usageRows(t))));
  }
}
