import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, run, exec, theme, shared, setShared, props, appHome } from "herdr";

const CWD = () => `${appHome()}/data/reviews/workspace`;
const REFRESH_MS = 2 * 60000;
const ICON = (name) => `mods/reviews/assets/${name}.svg`;
const tabName = (pr) => `#${pr.number} ${pr.repository?.name ?? ""}`.trim();
const reviewSpace = () => spaces().find((s) => s.folder === CWD());

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

export default class Reviews extends View {
  init(_props, cx) {
    if (props()?.watch) return this.initWatch(cx);
    this.hover = null;
  }

  initWatch(cx) {
    const load = async () => {
      const list = await fetchReviews();
      if (list) setShared("reviews.list", list);
    };
    cx.spawn(async () => load());
    cx.timer.every(REFRESH_MS, () => { load(); });
    this.asked = shared("reviews.refresh");
    cx.timer.every(1000, () => {
      if (shared("reviews.refresh") === this.asked) return;
      this.asked = shared("reviews.refresh");
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

  editInSession(pr) {
    setShared("sessions.composerText", `${pr.url}\n\n`);
    run("sessions.new-session");
  }

  hovering(key) {
    return (hovered, cx) => {
      const next = hovered ? key : this.hover === key ? null : this.hover;
      if (next !== this.hover) { this.hover = next; cx.notify(); }
    };
  }

  render() {
    if (props()?.watch) return div();
    const t = theme();
    const list = shared("reviews.list");
    const space = reviewSpace();
    const shownTab = space?.active ? space.tabs.find((tab) => tab.active)?.name : null;
    const button = (id, tip, icon, onClick) => div().id(id).flex_none().p(3).rounded(4).text_color(t.dim)
      .hover((st) => st.bg(t.raised).text_color(t.foreground)).tooltip(tip)
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
      .child(svg(icon).size(11));
    const row = (pr) => {
      const key = `review-${pr.url}`;
      const on = shownTab === tabName(pr);
      const shown = this.hover === key;
      return h_flex().id(key).px(8).py(6).gap(8).items_center().rounded(8).cursor_pointer()
        .on_hover(this.hovering(key))
        .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((st) => st.bg(t.hover)))
        .on_click(() => { this.openReview(pr).catch(() => null); })
        .child(svg(ICON(pr.isDraft ? "pr-draft" : "pr-open")).size(13).flex_none().text_color(pr.isDraft ? t.dim : t.done))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().text_size(13).text_color(t.foreground).child(pr.title))
          .child(div().truncate().text_size(11).text_color(t.dim).child(`${pr.repository?.name ?? ""}#${pr.number} · @${pr.author?.login ?? "ghost"} · ${age(pr.updatedAt)}`)))
        .when(shown, (el) => el
          .child(button(`${key}-edit`, "Check it out in a new session to make changes", "mods/workspace-chrome/square-pen.svg", () => this.editInSession(pr)))
          .child(button(`${key}-github`, "Open on GitHub", ICON("external-link"), () => exec("open", [pr.url]))));
    };
    return v_flex().size_full().min_h(0).bg(t.chrome)
      .child(h_flex().flex_none().px(14).pt(4).pb(8).gap(8).items_center()
        .child(div().flex_1().text_size(12.5).font_medium().text_color(t.foreground).child(list ? `Reviews · ${list.length}` : "Reviews"))
        .child(div().id("reviews-refresh").px(6).py(2).rounded(4).text_size(11.5).text_color(t.dim).cursor_pointer()
          .hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip("Ask GitHub again now")
          .on_click(() => setShared("reviews.refresh", Date.now()))
          .child("Refresh")))
      .child(v_flex().id("reviews-list").flex_1().min_h(0).px(8).pb(14).gap(2).overflow_y_scrollbar()
        .when(!list, (el) => el.child(div().px(8).py(8).text_size(12.5).text_color(t.dim).child("Asking GitHub…")))
        .when(Boolean(list) && list.length === 0, (el) => el.child(div().px(8).py(8).text_size(12.5).text_color(t.dim).child("No reviews waiting for you.")))
        .children((list ?? []).map(row)));
  }
}
