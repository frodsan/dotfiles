import { div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, setShared, layout, settings } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export function initBar(view) {
  view.pressed = null;
  view.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
}

function syncPanel(view, space, panel, body, enabled) {
  if (!space || !panel) return;
  const now = panel.hidden ? null : body?.active ?? null;
  if (space.id !== view.space) {
    const first = view.space === undefined;
    view.space = space.id; view.pending = null;
    if (!(first && !(space.id in view.panels))) {
      const stored = view.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
      if (want !== now) {
        view.pending = { want, until: Date.now() + 1000 };
        if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
        else run("layout.hide", { id: "panel" });
        return;
      }
    }
  }
  if (view.pending) {
    if (view.pending.want !== now && Date.now() < view.pending.until) return;
    view.pending = null;
  }
  if (view.panels[space.id] === now) return;
  view.panels[space.id] = now;
  localStorage.setItem("panels", JSON.stringify(view.panels));
}

export function renderBar(view, isChat) {
  const t = theme();
  const space = spaces().find(p => p.active);
  const shown = space?.tabs ?? [];
  const stop = (_e, cx) => cx.stop_propagation();
  const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
    .on_mouse_down("left", stop).on_click(action).child(label);
  const item = (c, i) => {
    const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
    const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
    return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
      .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover))
      .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); view.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
      .on_mouse_up("left", () => {
        const from = view.pressed; view.pressed = null;
        if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
        else run("tab.select", { id: c.id });
      })
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
      .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
      .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
      .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
      .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
      .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
  };
  const root = layout(), sidebar = find(root, "sidebar"), w = window();
  const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
    ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
    : 10;
  const panel = find(root, "panel"), body = find(root, "panel-body");
  const enabled = isChat ? [] : ["pull-request"];
  const offer = space ? (shared("pr.autoFixOffer") ?? {})[space.id] ?? null : null;
  const badge = shared("pr.badge");
  const pr = badge && badge.space === space?.id ? badge : null;
  syncPanel(view, space, panel, body, enabled);
  const toolButton = (id, label, icon) => {
    const tracked = (shared("tools.panes") ?? {})[`${space?.id}|${id}`];
    const tabbed = (shared("tools.tabs") ?? {})[`${space?.id}|${id}`]?.tab;
    const on = id === "files" ? Boolean(tabbed) && space?.tabs?.some(x => x.id === tabbed && x.active) : Boolean(tracked) && panes().some(p => p.pane === tracked);
    return h_flex().id(`tool-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
      .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
      .on_click(() => run(`sessions.${id}`)).child(svg(icon).size(14)).child(label);
  };
  const panelButton = (id, label, icon) => {
    const on = panel && !panel.hidden && body?.active === id;
    return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
      .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
      .on_click(() => {
        if (on) run("layout.hide", { id: "panel" });
        else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
      }).child(svg(icon).size(14)).child(label);
  };
  return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
    .on_mouse_up("left", () => { view.pressed = null; })
    .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
    .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map(item)))
    .when(!isChat && Boolean(offer), el => el.child(h_flex().id("autofix-offer").h(26).px(8).gap(5).flex_none().items_center().rounded(6)
      .text_size(12).bg(t.selected).text_color(t.foreground).hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
      .tooltip("Auto-fix waits while you look at this session. Click to send it to Claude now.")
      .on_click(() => setShared("sessions.forward", { command: "autofix-now", at: Date.now() }))
      .child(svg("mods/sessions/assets/wrench.svg").size(13).text_color(t.working)).child(`Auto-fix: ${offer.summary}`).child(div().text_color(t.accent).child("Run"))))
    .when(!isChat, el => el
      .child(toolButton("files", "Files", "mods/files/file.svg"))
      .child(toolButton("changes", "Changes", "mods/changes/changes.svg"))
      .child(panelButton("pull-request", pr ? `#${pr.number}` : "Pull request", "mods/sessions/assets/pr-open.svg")
        .when(Boolean(pr?.ci), el => el.child(div().size(7).rounded(4).flex_none().bg(pr.ci === "failed" ? t.ansi1 : pr.ci === "running" ? t.working : t.done)))))
    .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/sessions/assets/win-min.svg").size(16) : "−", () => run("window.minimize")))
      .child(button("maximize", w.platform === "windows" ? svg(`mods/sessions/assets/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
      .child(button("close-window", w.platform === "windows" ? svg("mods/sessions/assets/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
}
