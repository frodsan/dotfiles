import { View, div } from "gpui-kit";
import { v_flex, h_flex, Textarea, TextareaState } from "gpui-base";
import { exec, run, shared, notify, nextCommand, props, theme, openOverlay, closeOverlay } from "herdr";

const conf = () => shared("firehouse.settings") ?? {};
const base = (path) => (path ?? "").replace(/\/+$/, "").split("/").pop() || "~";
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const EVENT_ORDER = ["merged", "approved", "opened", "settled", "started", "worked"];
function previousWorkingDay(today = new Date()) {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  while (day.getDay() === 0 || day.getDay() === 6) day.setDate(day.getDate() - 1);
  return day;
}

function standupLabel(pr, baseRepo) {
  const repo = pr.url.match(/github\.com\/[^/]+\/([^/]+)\/pull\//)?.[1];
  return repo && repo !== baseRepo ? `${repo}/#${pr.number}` : `#${pr.number}`;
}

function standupLine(item, baseRepo, event) {
  const title = item.pr?.title ?? item.name;
  const link = item.pr ? ` [${standupLabel(item.pr, baseRepo)}](${item.pr.url})` : "";
  const suffix = event && ["merged", "approved", "opened", "settled"].includes(event) ? ` (${event})` : "";
  return `- ${title}${link}${suffix}`;
}

function buildStandup(today, baseRepo) {
  const log = shared("standup.log") ?? {};
  const previous = log[dayKey(previousWorkingDay())] ?? {};
  const seen = new Set();
  const yesterday = Object.values(previous)
    .map((item) => ({ item, event: EVENT_ORDER.find((e) => item.events.includes(e)) }))
    .sort((a, b) => EVENT_ORDER.indexOf(a.event) - EVENT_ORDER.indexOf(b.event))
    .filter(({ item }) => {
      const key = item.pr?.url ?? item.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ item, event }) => standupLine(item, baseRepo, event));
  const todayLines = today.map((item) => standupLine(item, baseRepo, null));
  return [...(yesterday.length ? ["Yesterday:", ...yesterday, ""] : []), "Today:", ...(todayLines.length ? todayLines : ["- Nothing in focus yet"])].join("\n");
}

const LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
const escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const inlineHtml = (line) => {
  let html = "";
  let last = 0;
  for (const match of line.matchAll(LINK)) {
    html += escapeHtml(line.slice(last, match.index)) + `<a href="${escapeHtml(match[2])}">${escapeHtml(match[1])}</a>`;
    last = match.index + match[0].length;
  }
  return html + escapeHtml(line.slice(last));
};

function standupHtml(text) {
  const blocks = [];
  let items = [];
  const flush = () => {
    if (items.length) blocks.push(`<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`);
    items = [];
  };
  for (const line of text.split("\n")) {
    const bullet = line.match(/^\s*[-•*]\s+(.*)$/);
    if (bullet) items.push(inlineHtml(bullet[1]));
    else {
      flush();
      if (line.trim()) blocks.push(`<p>${inlineHtml(line)}</p>`);
    }
  }
  flush();
  return blocks.join("");
}

const COPY_SCRIPT = "function run(argv) { ObjC.import('AppKit'); const pb = $.NSPasteboard.generalPasteboard; pb.clearContents; pb.setStringForType($(argv[0]), 'public.html'); pb.setStringForType($(argv[1]), 'public.utf8-plain-text'); }";


const COMMANDS = { aws: () => conf().awsCommand, mcp: () => conf().mcpCommand || "claude /mcp" };

async function open(kind) {
  if (!COMMANDS[kind]()) return notify({ title: "Set the AWS login command first", body: "Open Firehouse settings (⇧⌘,) and fill in AWS login command.", level: "warning" });
  const folder = conf().mainRepo;
  if (!folder) return notify({ title: "Choose your main repo first", body: "Open Firehouse settings (⇧⌘,) and pick the repo these tools run in.", level: "warning" });
  const shell = await exec("sh", ["-c", 'dscl . -read "/Users/$USER" UserShell 2>/dev/null | awk \'{print $2}\'']).catch(() => null);
  run("terminal.open", { argv: [shell?.stdout.trim() || "/bin/zsh", "-ilc", COMMANDS[kind]()], folder, place: "right" });
}

export default class WorkTools extends View {
  initStandup(cx) {
    this.copied = false;
    this.standupText = TextareaState.new({ value: "", rows: 14 });
    this.standupText.on("change", () => localStorage.setItem(`standup.${dayKey()}`, this.standupText.value()));
    const saved = localStorage.getItem(`standup.${dayKey()}`);
    cx.spawn(async (cx) => {
      if (saved) this.standupText.set_value(saved);
      else await this.resetStandup();
      cx.notify();
    });
  }

  async resetStandup() {
    const baseRepo = conf().mainRepo ? base(conf().mainRepo) : "";
    const today = (shared("sessions.today") ?? {})[localStorage.getItem("standup.today") === "worked" ? "worked" : "focus"] ?? [];
    const text = buildStandup(today, baseRepo);
    this.standupText.set_value(text);
    localStorage.setItem(`standup.${dayKey()}`, text);
  }

  renderStandup() {
    const t = theme();
    const text = this.standupText.value();
    const button = (id, label, primary, onClick) => h_flex().id(id).h(32).px(14).gap(6).flex_none().items_center().rounded(8).text_size(12.5).cursor_pointer()
      .when(primary, (el) => el.bg(t.solid).text_color(t.solid_foreground).hover((st) => st.opacity(0.88)))
      .when(!primary, (el) => el.border_1().border_color(t.input).text_color(t.foreground).hover((st) => st.bg(t.hover)))
      .on_click((_e, cx) => onClick(cx)).child(label);
    return v_flex().id("standup").size_full().min_h(0).p(22).gap(12).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); } })
      .child(h_flex().items_center().gap(6).child(div().flex_1().text_size(16).font_semibold().child("Standup update"))
        .children([["focus", "Focus sessions"], ["worked", "Worked on today"]].map(([value, label]) => {
          const on = (localStorage.getItem("standup.today") === "worked" ? "worked" : "focus") === value;
          return div().id(`standup-${value}`).px(10).py(4).rounded(7).text_size(12).cursor_pointer()
            .when(on, (el) => el.bg(t.selected).text_color(t.foreground)).when(!on, (el) => el.text_color(t.muted).hover((st) => st.bg(t.hover)))
            .on_click((_e, cx) => { localStorage.setItem("standup.today", value); cx.spawn(async (cx) => { await this.resetStandup(); cx.notify(); }); })
            .child(label);
        }))
        .child(div().pl(6).text_size(11).text_color(t.dim).child("Esc")))
      .child(div().text_size(12).text_color(t.dim).child("Yesterday comes from what you started, opened, merged, settled or worked on. Today lists your focus sessions or the sessions you worked on today: pick one above. Edit it, then paste it in the standup thread."))
      .child(div().flex_1().min_h(120).rounded(10).border_1().border_color(t.border).bg(t.background).p(10).child(Textarea.new(this.standupText).size_full().text_size(13).text_color(t.foreground)))
      .child(h_flex().flex_none().gap(8).items_center()
        .child(button("standup-reset", "Reset", false, (cx) => cx.spawn(async (cx) => { await this.resetStandup(); cx.notify(); })))
        .child(div().flex_1())
        .child(button("standup-copy", this.copied ? "Copied ✓" : "Copy for Slack", true, (cx) => cx.spawn(async (cx) => {
          const plain = text.replace(LINK, (_m, label, url) => `${label} (${url})`);
          await exec("osascript", ["-l", "JavaScript", "-e", COPY_SCRIPT, standupHtml(text), plain]);
          this.copied = true;
          cx.notify();
          cx.timer.after(1500, (cx) => { this.copied = false; cx.notify(); });
        }))));
  }


  init(_props, cx) {
    if (props()?.standup) return this.initStandup(cx);
    cx.spawn(async () => {
      for (;;) {
        const command = await nextCommand();
        if (command === "standup") openOverlay({ mod: "work-tools", kind: "dialog", width: 680, height: 520, props: { standup: true } });
        else if (COMMANDS[command]) await open(command);
      }
    });
  }

  render() {
    if (props()?.standup) return this.renderStandup();
    return div();
  }
}
