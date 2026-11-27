import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, run, exec, theme, shared, setShared, props, appHome, openOverlay, closeOverlay } from "herdr";

const CWD = () => `${appHome()}/data/reviews/workspace`;
const refreshMs = () => ((shared("firehouse.settings") ?? {}).reviewsRefreshMinutes ?? 2) * 60000;
const ICON = (name) => `mods/reviews/assets/${name}.svg`;
const tabName = (pr) => `#${pr.number} ${pr.repository?.name ?? ""}`.trim();
const reviewSpace = () => spaces().find((s) => s.folder === CWD());
const SNOOZED = "reviews.snoozed";
const snoozedUntil = (pr) => ((shared(SNOOZED) ?? {})[pr.url]?.until ?? 0);
const isSnoozed = (pr, now = Date.now()) => snoozedUntil(pr) > now;

async function fetchReviews() {
  const r = await exec("gh", ["search", "prs", "user-review-requested:@me", "--state=open", "--json", "number,title,url,repository,author,updatedAt,isDraft", "--limit", "50"]).catch(() => null);
  if (r?.code !== 0) return null;
  try {
    return JSON.parse(r.stdout).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  } catch {
    return null;
  }
}

function age(iso) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

function when(until) {
  const d = new Date(until);
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  const days = Math.round((new Date(d.toDateString()) - new Date(new Date().toDateString())) / 86400000);
  if (days === 0) return time;
  if (days === 1) return `tomorrow ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

export default class Reviews extends View {
  init(_props, cx) {
    if (props()?.watch) return this.initWatch(cx);
    if (props()?.menu) return;
    cx.timer.every(30000, (cx) => cx.notify());
  }

  initWatch(cx) {
    const load = async () => {
      const list = await fetchReviews();
      if (!list) return;
      setShared("reviews.list", list);
      const urls = new Set(list.map((pr) => pr.url));
      const snoozed = shared(SNOOZED) ?? {};
      const kept = Object.fromEntries(Object.entries(snoozed).filter(([url, v]) => urls.has(url) && v.until > Date.now()));
      if (Object.keys(kept).length !== Object.keys(snoozed).length) setShared(SNOOZED, kept);
    };
    let loadedAt = Date.now();
    cx.spawn(async () => load());
    cx.timer.every(15000, () => {
      if (Date.now() - loadedAt < refreshMs()) return;
      loadedAt = Date.now();
      load();
    });
    this.asked = shared("reviews.refresh");
    cx.timer.every(1000, () => {
      if (shared("reviews.refresh") === this.asked) return;
      this.asked = shared("reviews.refresh");
      loadedAt = Date.now();
      load();
    });
  }

  async openReview(pr) {
    await exec("mkdir", ["-p", CWD()]);
    const name = tabName(pr);
    const argv = ["tuicr", "pr", pr.url];
    const space = reviewSpace();
    if (!space) return run("space.new", { name: "Reviews", folder: CWD(), tab: name, argv, machine: "" });
    run("space.select", { id: space.id });
    const tab = space.tabs.find((t) => t.named && t.name === name);
    if (tab) run("tab.select", { id: tab.id });
    else run("tab.new", { space: space.id, name, folder: CWD(), argv });
  }

  snooze(pr) {
    openOverlay({ mod: "sessions", kind: "popup", width: 280, height: 300, props: { menu: { id: pr.url, snoozeOnly: true, store: SNOOZED } } });
  }

  editInSession(pr) {
    setShared("sessions.composerText", `${pr.url}\n\n`);
    run("sessions.new-session");
  }

  renderMenu() {
    const t = theme();
    const { pr } = props().menu;
    const close = () => closeOverlay(props().overlay);
    const item = (key, label, icon, action) => h_flex().id(`menu-${key}`).h(28).px(10).gap(8).items_center().rounded(6).text_size(12.5).text_color(t.foreground)
      .cursor_pointer().hover((st) => st.bg(t.hover))
      .on_click(() => { close(); action(); })
      .child(svg(icon).size(13).flex_none().text_color(t.muted))
      .child(div().flex_1().truncate().child(label));
    return v_flex().id("reviews-menu").w_full().p(5).bg(t.popover)
      .on_key_down((e, cx) => { if (e.key === "escape") { close(); cx.stop_propagation(); } })
      .child(item("spin-off", "Spin off a session", "mods/workspace-chrome/square-pen.svg", () => this.editInSession(pr)))
      .child(div().my(4).h(1).bg(t.border))
      .child(item("snooze", isSnoozed(pr) ? `Snoozed until ${when(snoozedUntil(pr))}…` : "Snooze…", ICON("clock"), () => this.snooze(pr)))
      .child(div().my(4).h(1).bg(t.border))
      .child(item("github", "Open on GitHub", ICON("external-link"), () => exec("open", [pr.url])));
  }

  repoGroups(waiting, row, t) {
    const collapsed = new Set(JSON.parse(localStorage.getItem("reviews.collapsed") ?? "[]"));
    const groups = new Map();
    for (const pr of waiting) {
      const repo = pr.repository?.name ?? "";
      groups.set(repo, [...(groups.get(repo) ?? []), pr]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" })).flatMap(([repo, prs]) => {
      const closed = collapsed.has(repo);
      const head = h_flex().id(`repo-${repo}`).mt(10).px(6).py(4).gap(6).items_center().rounded(6).text_size(13).font_semibold().text_color(t.foreground).cursor_pointer()
        .hover((st) => st.bg(t.hover))
        .on_click((_e, cx) => {
          if (closed) collapsed.delete(repo); else collapsed.add(repo);
          localStorage.setItem("reviews.collapsed", JSON.stringify([...collapsed]));
          cx.notify();
        })
        .child(svg(ICON(closed ? "chevron-right" : "chevron-down")).size(12).flex_none().text_color(t.dim))
        .child(div().flex_1().min_w(0).truncate().child(repo))
        .child(div().flex_none().text_size(11.5).font_normal().text_color(t.dim).child(String(prs.length)));
      return closed ? [head] : [head, ...prs.map((pr) => row(pr, true))];
    });
  }

  snoozedList(sleeping, row, t) {
    if (!sleeping.length) return [];
    const open = localStorage.getItem("reviews.snoozed.open") === "1";
    const head = h_flex().id("reviews-snoozed").mt(12).px(6).py(4).gap(6).items_center().rounded(6).text_size(12).text_color(t.dim).cursor_pointer().hover((st) => st.bg(t.hover))
      .on_click((_e, cx) => { localStorage.setItem("reviews.snoozed.open", open ? "0" : "1"); cx.notify(); })
      .child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(12).flex_none())
      .child(svg(ICON("clock")).size(12).flex_none())
      .child(div().flex_1().font_medium().child(`Snoozed · ${sleeping.length}`));
    return open ? [head, ...sleeping.map((pr) => row(pr))] : [head];
  }

  render() {
    if (props()?.watch) return div();
    if (props()?.menu) return this.renderMenu();
    const t = theme();
    const list = shared("reviews.list");
    const now = Date.now();
    const waiting = (list ?? []).filter((pr) => !isSnoozed(pr, now));
    const sleeping = (list ?? []).filter((pr) => isSnoozed(pr, now)).sort((a, b) => snoozedUntil(a) - snoozedUntil(b));
    const space = reviewSpace();
    const shownTab = space?.active ? space.tabs.find((tab) => tab.active)?.name : null;
    const row = (pr, grouped = false) => {
      const key = `review-${pr.url}`;
      const on = shownTab === tabName(pr);
      return h_flex().id(key).px(8).py(6).gap(8).items_center().rounded(8).cursor_pointer()
        .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((st) => st.bg(t.hover)))
        .on_click(() => { this.openReview(pr).catch(() => null); })
        .on_mouse_down("right", () => openOverlay({ mod: "reviews", kind: "popup", width: 240, height: 132, props: { menu: { pr } } }))
        .child(svg(ICON(pr.isDraft ? "pr-draft" : "pr-open")).size(13).flex_none().text_color(pr.isDraft ? t.dim : t.done))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().text_size(13).text_color(t.foreground).child(pr.title))
          .child(div().truncate().text_size(11).text_color(t.dim).child(isSnoozed(pr) ? `${pr.repository?.name ?? ""}#${pr.number} · until ${when(snoozedUntil(pr))}` : `${grouped ? "" : pr.repository?.name ?? ""}#${pr.number} · @${pr.author?.login ?? "ghost"} · ${age(pr.updatedAt)}`)));
    };
    return v_flex().size_full().min_h(0).bg(t.chrome)
      .child(h_flex().flex_none().px(14).pt(4).pb(8).gap(8).items_center()
        .child(div().flex_1().text_size(12.5).font_medium().text_color(t.foreground).child(list ? `Reviews · ${waiting.length}` : "Reviews"))
        .child(div().id("reviews-refresh").px(6).py(2).rounded(4).text_size(11.5).text_color(t.dim).cursor_pointer()
          .hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip("Ask GitHub again now")
          .on_click(() => setShared("reviews.refresh", Date.now()))
          .child("Refresh")))
      .child(v_flex().id("reviews-list").flex_1().min_h(0).px(8).pb(14).gap(2).overflow_y_scrollbar()
        .when(!list, (el) => el.child(div().px(8).py(8).text_size(12.5).text_color(t.dim).child("Asking GitHub…")))
        .when(Boolean(list) && waiting.length === 0, (el) => el.child(div().px(8).py(8).text_size(12.5).text_color(t.dim).child("No reviews waiting for you.")))
        .children(this.repoGroups(waiting, row, t))
        .children(this.snoozedList(sleeping, row, t)));
  }
}
