import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, run, exec, theme, shared, setShared, nextCommand, readTextFile, writeTextFile, appHome, home, props, openOverlay, hc } from "herdr";

const CLAUDE = "claude";
const CHATS_DIR = () => `${appHome()}/data/chats`;
const CHATS_CWD = () => `${CHATS_DIR()}/workspace`;
const CHATS_META = () => `${CHATS_DIR()}/chats.json`;
const CHATS_PROJECT = () => `${home()}/.claude/projects/${CHATS_CWD().replace(/[^A-Za-z0-9]/g, "-")}`;
const map = (key) => shared(key) ?? {};
const isChatSpace = (s) => s.folder === CHATS_CWD() || Object.values(map("chats.space")).includes(s.id);
const chatTitle = (title) => { const t = (title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim(); return t && !/^claude( code)?$/i.test(t) ? t : null; };
const newUuid = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = Math.floor(Math.random() * 16); return (c === "x" ? r : (r & 3) | 8).toString(16); });

async function updateChatsMeta(change) {
  const raw = await readTextFile(CHATS_META()).catch(() => null);
  const meta = JSON.parse(raw ?? "{}");
  const next = change(meta) ?? meta;
  await writeTextFile(CHATS_META(), JSON.stringify(next, null, 2), raw);
  return next;
}

function claudePane(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((t) => t.id));
  return ps.find((p) => tabs.has(p.tab) && p.terminal && (p.program?.key === "claude" || /claude/i.test(p.app ?? "")));
}

const DAY = 86400000;
const quickFlags = () => { const c = { quickModel: "haiku", quickEffort: null, ...(shared("firehouse.settings") ?? {}) }; return ["--model", c.quickModel, ...(c.quickEffort ? ["--effort", c.quickEffort] : [])]; };
const keepDays = () => (shared("firehouse.settings") ?? {}).archivedDays ?? 7;
const claudeRunning = (p) => p.program?.key === "claude" || p.status != null;

async function trashChat(id) {
  const script = 'mkdir -p "$HOME/.Trash" && for p in "$1/$2.jsonl" "$1/$2"; do [ -e "$p" ] && mv "$p" "$HOME/.Trash/chat-$(basename "$p")-$3"; done; true';
  await exec("sh", ["-c", script, "sh", CHATS_PROJECT(), id, String(Date.now())]).catch(() => null);
  await updateChatsMeta((m) => { delete m[id]; });
  const live = { ...map("chats.space") };
  delete live[id];
  setShared("chats.space", live);
}

const TITLE_PROMPT = "You name chat conversations. Reply with only a title of 3 to 6 words, in sentence case, that says what this first message asks about. No quotes, no trailing period, nothing else.";

async function shellRun(script, args) {
  const shell = await exec("sh", ["-c", 'dscl . -read "/Users/$USER" UserShell 2>/dev/null | awk \'{print $2}\'']).catch(() => null);
  return exec(shell?.stdout.trim() || "/bin/zsh", ["-ilc", script, "sh", ...args]);
}

async function firstStartSinceBoot(key) {
  const r = await exec("sysctl", ["-n", "kern.boottime"]).catch(() => null);
  const boot = r?.stdout.match(/sec = (\d+)/)?.[1];
  if (!boot) return false;
  const seen = shared(key);
  if (seen === boot) return false;
  setShared(key, boot);
  return seen != null;
}

const setArchived = (id, on) => updateChatsMeta((m) => {
  m[id] = { ...(m[id] ?? {}) };
  if (on) m[id].archivedAt = Date.now();
  else delete m[id].archivedAt;
});

export default class Chats extends View {
  init(_props, cx) {
    if (props()?.watch) return this.initWatch(cx);
    this.hover = null;
    cx.spawn(async (cx) => this.loadChats(cx));
    cx.timer.every(10000, (cx) => this.loadChats(cx));
    this.changed = shared("chats.changed");
    cx.timer.every(500, (cx) => {
      if (shared("chats.changed") === this.changed) return;
      this.changed = shared("chats.changed");
      this.loadChats(cx);
    });
  }

  initWatch(cx) {
    this.ranClaude = new Set();
    cx.timer.every(500, () => this.adoptCreated());
    cx.timer.every(1000, () => this.closeExited());
    cx.timer.every(10000, (cx) => { this.nameChatSpaces(); cx.spawn(async () => { await this.titleChats().catch(() => null); }); });
    cx.spawn(async () => this.purgeArchived());
    cx.timer.every(600000, () => { this.purgeArchived(); });
    cx.timer.after(8000, () => { this.resumeAfterBoot().catch(() => null); });
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        try {
          if (command === "new") this.newChat(cx);
          else if (command === "remove") await this.removePending();
        } catch {}
      }
    });
  }

  async resumeAfterBoot() {
    if (!(await firstStartSinceBoot("chats.bootResumed"))) return;
    const ps = panes();
    for (const [chat, spaceId] of Object.entries(map("chats.space"))) {
      const space = spaces().find((s) => s.id === spaceId);
      if (!space) continue;
      const tabs = new Set(space.tabs.map((tab) => tab.id));
      const own = ps.filter((p) => tabs.has(p.tab));
      if (own.some(claudeRunning) || own.length !== 1 || !own[0].terminal) continue;
      const stored = await exec("test", ["-f", `${CHATS_PROJECT()}/${chat}.jsonl`]).then((r) => r.code === 0).catch(() => false);
      if (stored) hc(["send", own[0].terminal, `${CLAUDE} --resume ${chat}`]);
    }
  }

  async titleChats() {
    if (this.titling) return;
    this.titling = true;
    try {
      const meta = JSON.parse((await readTextFile(CHATS_META()).catch(() => null)) ?? "{}");
      for (const [id, m] of Object.entries(meta)) {
        if (m.titled || m.archivedAt) continue;
        const first = await exec("sh", ["-c", 'head -c 400000 "$1" 2>/dev/null | grep -m1 -F "$2"', "sh", `${CHATS_PROJECT()}/${id}.jsonl`, '"type":"user"']).catch(() => null);
        let text = "";
        try { const c = JSON.parse(first?.stdout ?? "").message?.content; text = typeof c === "string" ? c : (c ?? []).map((x) => x.text ?? "").join(" "); } catch {}
        text = text.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, "").replace(/\s+/g, " ").trim();
        if (!text) continue;
        const r = await shellRun('claude -p "$@" < /dev/null', [...quickFlags(), `${TITLE_PROMPT}\n\n<message>\n${text.slice(0, 2000)}\n</message>`]).catch(() => null);
        const title = (r?.code === 0 ? r.stdout : "").split("\n").map((l) => l.trim()).find(Boolean)?.replace(/^["'“]+|["'”.]+$/g, "").slice(0, 60);
        if (!title) continue;
        await updateChatsMeta((all) => { all[id] = { ...(all[id] ?? {}), name: title, titled: true }; });
        const spaceId = map("chats.space")[id];
        if (spaces().some((sp) => sp.id === spaceId)) run("space.rename", { id: spaceId, name: title });
        setShared("chats.changed", Date.now());
      }
    } finally {
      this.titling = false;
    }
  }

  closeExited() {
    const links = Object.entries(map("chats.space"));
    const ps = panes();
    for (const [chat, spaceId] of links) {
      const space = spaces().find((s) => s.id === spaceId);
      if (!space) { this.ranClaude.delete(spaceId); continue; }
      const tabs = new Set(space.tabs.map((tab) => tab.id));
      const own = ps.filter((p) => tabs.has(p.tab));
      if (own.some(claudeRunning)) { this.ranClaude.add(space.id); continue; }
      if (!this.ranClaude.has(space.id) || own.length !== 1 || !own[0].terminal) continue;
      this.ranClaude.delete(space.id);
      run("space.close", { id: space.id, confirmed: true });
      setArchived(chat, true).catch(() => null);
    }
  }

  async purgeArchived() {
    const meta = JSON.parse((await readTextFile(CHATS_META()).catch(() => null)) ?? "{}");
    const cutoff = Date.now() - keepDays() * DAY;
    for (const [id, m] of Object.entries(meta)) {
      if (m.archivedAt && m.archivedAt < cutoff) await trashChat(id);
    }
  }

  adoptCreated() {
    const pending = shared("chats.pending") ?? [];
    if (!pending.length) return;
    const linked = new Set(Object.values(map("chats.space")));
    const left = pending.filter((p) => {
      if (Date.now() - p.at > 120000) return false;
      const space = spaces().find((s) => s.named && s.name === p.name && isChatSpace(s) && !linked.has(s.id));
      if (!space) return true;
      setShared("chats.space", { ...map("chats.space"), [p.chat]: space.id });
      linked.add(space.id);
      return false;
    });
    if (left.length !== pending.length) setShared("chats.pending", left);
  }

  hovering(key) {
    return (hovered, cx) => {
      const next = hovered ? key : this.hover === key ? null : this.hover;
      if (next !== this.hover) { this.hover = next; cx.notify(); }
    };
  }

  reveal(key) {
    return (el) => (this.hover !== key ? el.invisible() : el);
  }

  nameChatSpaces() {
    const ps = panes();
    const links = Object.entries(map("chats.space"));
    const names = {};
    for (const sp of spaces().filter((s) => isChatSpace(s) && s.name === "New chat")) {
      const name = chatTitle(claudePane(sp, ps)?.title);
      if (!name) continue;
      run("space.rename", { id: sp.id, name });
      const chat = links.find(([, spaceId]) => spaceId === sp.id)?.[0];
      if (chat) names[chat] = name;
    }
    if (Object.keys(names).length) updateChatsMeta((m) => { for (const [id, name] of Object.entries(names)) m[id] = { ...(m[id] ?? {}), name }; }).catch(() => null);
  }

  async loadChats(cx) {
    if (this.chatsLoading) return;
    this.chatsLoading = true;
    try {
      await exec("mkdir", ["-p", CHATS_CWD()]);
      let meta = JSON.parse((await readTextFile(CHATS_META()).catch(() => null)) ?? "{}");
      const names = {};
      const r = await exec("sh", ["-c", 'cd "$1" 2>/dev/null && for f in *.jsonl; do [ -f "$f" ] && printf "%s %s\n" "$(date -r "$f" +%s)" "$f"; done', "sh", CHATS_PROJECT()]).catch(() => null);
      const files = (r?.stdout ?? "").split("\n").filter(Boolean).map((line) => { const [at, file] = line.split(" "); return { id: file.replace(/\.jsonl$/, ""), at: Number(at) * 1000 }; });
      const live = new Set(spaces().map((sp) => sp.id));
      const stored = new Set(files.map((x) => x.id));
      const claimed = new Set(Object.keys(meta));
      const moves = [];
      const orphans = Object.entries(meta).filter(([id, m]) => !stored.has(id) && m.createdAt && live.has(map("chats.space")[id])).sort((a, b) => b[1].createdAt - a[1].createdAt);
      for (const [id, m] of orphans) {
        const file = files.filter((f) => !claimed.has(f.id) && f.at >= m.createdAt).sort((a, b) => b.at - a.at)[0];
        if (!file) continue;
        claimed.add(file.id);
        moves.push([id, file.id]);
      }
      if (moves.length) {
        meta = await updateChatsMeta((m) => { for (const [from, to] of moves) { m[to] = m[from]; delete m[from]; } });
        const links = { ...map("chats.space") };
        for (const [from, to] of moves) { links[to] = links[from]; delete links[from]; }
        setShared("chats.space", links);
      }
      let changed = false;
      for (const file of files) {
        if (meta[file.id]?.name && meta[file.id].name !== "New chat") continue;
        const path = `${CHATS_PROJECT()}/${file.id}.jsonl`;
        const title = await exec("sh", ["-c", 'grep -F "$2" "$1" | tail -1', "sh", path, '"type":"ai-title"']).catch(() => null);
        let text = "";
        try { text = JSON.parse(title?.stdout ?? "").aiTitle ?? ""; } catch {}
        if (!text) {
          const first = await exec("sh", ["-c", 'head -c 400000 "$1" | grep -m1 -F "$2"', "sh", path, '"type":"user"']).catch(() => null);
          try { const c = JSON.parse(first?.stdout ?? "").message?.content; text = typeof c === "string" ? c : (c ?? []).map((x) => x.text ?? "").join(" "); } catch {}
        }
        text = text.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, "").replace(/\s+/g, " ").trim();
        if (!text) continue;
        names[file.id] = text.length > 60 ? `${text.slice(0, 57)}…` : text;
        changed = true;
      }
      if (changed) meta = await updateChatsMeta((m) => { for (const [id, name] of Object.entries(names)) m[id] = { ...(m[id] ?? {}), name }; });
      for (const [id, spaceId] of Object.entries(map("chats.space"))) {
        const name = meta[id]?.name;
        const space = spaces().find((sp) => sp.id === spaceId);
        if (space?.name === "New chat" && name && name !== "New chat") run("space.rename", { id: spaceId, name });
      }
      const ids = new Set(files.map((x) => x.id));
      const fresh = Object.entries(meta).filter(([id]) => !ids.has(id)).map(([id, m]) => ({ id, at: m.createdAt ?? 0 }));
      this.chats = [...files, ...fresh].map((x) => ({ id: x.id, at: x.at, name: meta[x.id]?.name ?? "New chat", archivedAt: meta[x.id]?.archivedAt ?? null })).sort((a, b) => b.at - a.at);
    } finally {
      this.chatsLoading = false;
      cx.notify();
    }
  }

  async openChat(chat) {
    if (chat.archivedAt) { chat.archivedAt = null; await setArchived(chat.id, false); }
    const spaceId = map("chats.space")[chat.id];
    const existing = spaces().find((sp) => sp.id === spaceId);
    if (existing) return run("space.select", { id: existing.id });
    await exec("mkdir", ["-p", CHATS_CWD()]);
    const stored = await exec("test", ["-f", `${CHATS_PROJECT()}/${chat.id}.jsonl`]).then((r) => r.code === 0).catch(() => false);
    setShared("chats.pending", [...(shared("chats.pending") ?? []), { name: chat.name, chat: chat.id, at: Date.now() }]);
    run("space.new", { name: chat.name, folder: CHATS_CWD(), argv: stored ? [CLAUDE, "--resume", chat.id] : [CLAUDE, "--session-id", chat.id] });
  }

  confirmRemove(chat) {
    setShared("chats.removing", chat.id);
    openOverlay({ mod: "confirm", kind: "dialog", width: 420, height: 180, props: {
      title: "Remove chat?",
      detail: `Herdr closes “${chat.name}” and moves its Claude conversation to the Trash.`,
      command: { name: "chats.remove", args: {} },
    } });
  }

  async removePending() {
    const id = shared("chats.removing");
    if (!id) return;
    setShared("chats.removing", null);
    const spaceId = map("chats.space")[id];
    if (spaces().some((sp) => sp.id === spaceId)) run("space.close", { id: spaceId, confirmed: true });
    await trashChat(id);
    setShared("chats.changed", Date.now());
  }

  archiveChat(chat, cx) {
    cx.spawn(async (cx) => {
      const spaceId = map("chats.space")[chat.id];
      if (spaces().some((sp) => sp.id === spaceId)) run("space.close", { id: spaceId });
      await setArchived(chat.id, true);
      await this.loadChats(cx);
    });
  }

  newChat(cx) {
    cx.spawn(async (cx) => {
      await exec("mkdir", ["-p", CHATS_CWD()]);
      const id = newUuid();
      await updateChatsMeta((m) => { m[id] = { name: "New chat", createdAt: Date.now() }; });
      await this.openChat({ id, name: "New chat" });
      await this.loadChats(cx);
    });
  }

  chatsList(t, cx) {
    if (!this.chats && !this.chatsLoading) cx.spawn(async (cx) => this.loadChats(cx));
    const chats = this.chats ?? [];
    const active = chats.filter((c) => !c.archivedAt);
    const archived = chats.filter((c) => c.archivedAt).sort((a, b) => b.archivedAt - a.archivedAt);
    const live = map("chats.space");
    const activeId = spaces().find((sp) => sp.active)?.id;
    const age = (at) => {
      const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
      if (minutes < 60) return `${minutes}m`;
      const hours = Math.round(minutes / 60);
      return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
    };
    const row = (chat) => {
      const spaceId = live[chat.id];
      const space = spaces().find((sp) => sp.id === spaceId);
      const on = Boolean(space) && space.id === activeId;
      const key = `chat-${chat.id}`;
      return h_flex().id(key).px(8).py(6).gap(8).items_center().rounded(8).cursor_pointer()
        .on_hover(this.hovering(key))
        .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((st) => st.bg(t.hover)))
        .on_click((_e, cx) => { this.openChat(chat).catch(() => null); cx.notify(); })
        .child(div().flex_none().size(6).rounded(3).bg(space?.status === "working" ? t.working : space?.status === "blocked" ? t.blocked : space ? t.done : t.chrome))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().text_size(13).text_color(t.foreground).child(chat.name))
          .child(div().truncate().text_size(11).text_color(t.dim).child(chat.archivedAt ? `archived ${age(chat.archivedAt)} ago` : chat.at ? `${age(chat.at)} ago` : "not started")))
        .when(!chat.archivedAt, (el) => el.child(div().id(`${key}-archive`).flex_none().p(3).rounded(4).text_color(t.dim)
          .map(this.reveal(key))
          .hover((st) => st.bg(t.raised).text_color(t.foreground))
          .tooltip(`Archive this chat. It moves to the Trash after ${keepDays()} days.`)
          .on_click((_e, cx) => { cx.stop_propagation(); this.archiveChat(chat, cx); })
          .child(svg("mods/chats/assets/archive.svg").size(11))))
        .child(div().id(`${key}-remove`).flex_none().p(3).rounded(4).text_color(t.dim)
          .map(this.reveal(key))
          .hover((st) => st.bg(t.raised).text_color(t.foreground))
          .tooltip("Remove this chat")
          .on_click((_e, cx) => { cx.stop_propagation(); this.confirmRemove(chat); })
          .child(svg("mods/workspace-chrome/x.svg").size(11)));
    };
    return v_flex().flex_1().min_h(0)
      .child(h_flex().flex_none().px(14).pt(4).pb(8).gap(8).items_center()
        .child(div().flex_1().text_size(12.5).font_medium().child("Chats"))
        .child(div().id("chat-new").p(4).rounded(6).text_color(t.dim).cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip("New chat")
          .on_click((_e, cx) => this.newChat(cx))
          .child(svg("mods/chats/assets/plus.svg").size(13))))
      .child(v_flex().id("chats-list").flex_1().min_h(0).px(8).pb(14).gap(2).overflow_y_scrollbar()
        .when(Boolean(this.chats) && active.length === 0, (el) => el.child(div().px(8).py(8).text_size(12.5).text_color(t.dim).child("No chats yet. Press + to start one.")))
        .children(active.map(row))
        .children(this.archivedList(archived, row, t)));
  }

  archivedList(archived, row, t) {
    if (!archived.length) return [];
    const open = localStorage.getItem("chats.archived.open") === "1";
    const head = h_flex().id("chats-archived").mt(12).px(6).py(4).gap(6).items_center().rounded(6).text_size(12).text_color(t.dim).cursor_pointer().hover((st) => st.bg(t.hover))
      .tooltip(`Archived chats move to the Trash after ${keepDays()} days, as set in Firehouse settings`)
      .on_click((_e, cx) => { localStorage.setItem("chats.archived.open", open ? "0" : "1"); cx.notify(); })
      .child(svg(`mods/chats/assets/${open ? "chevron-down" : "chevron-right"}.svg`).size(12).flex_none())
      .child(div().flex_1().font_medium().child(`Archived · ${archived.length}`));
    return open ? [head, ...archived.map(row)] : [head];
  }

  render(cx) {
    if (props()?.watch) return div();
    const t = theme();
    return v_flex().size_full().min_h(0).bg(t.chrome).child(this.chatsList(t, cx));
  }
}
