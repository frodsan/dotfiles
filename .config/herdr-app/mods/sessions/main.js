import { View, div, svg } from "gpui-kit";
import { initBar, renderBar } from "./bar.js";
import { PullRequestPanel } from "./pr.js";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { hc, keys, spaces, panes, machines, layout, run, exec, theme, shared, setShared, openOverlay, closeOverlay, props, nextCommand, playSound, readTextFile, writeTextFile, appHome, home, window, pickFolder, notify } from "herdr";

const ICON = (name) => `mods/sessions/${name}.svg`;
const GIT_REFRESH_MS = 60000;
const PR_FRESH_MS = 5000;
const CHATS_DIR = () => `${appHome()}/data/chats`;
const CHATS_CWD = () => `${CHATS_DIR()}/workspace`;
const isChatSpace = (s) => s.folder === CHATS_CWD() || Object.values(map("chats.space")).includes(s.id);
function snoozeStore(menu, until) {
  const all = { ...map(menu.store) };
  delete all[menu.id];
  if (until) all[menu.id] = { ...(menu.extra ?? {}), until };
  setShared(menu.store, all);
}

const prInterval = () => {
  const rate = shared("github.rateLimit");
  if (!rate || Date.parse(rate.resetAt) < Date.now()) return PR_FRESH_MS;
  return rate.remaining < 100 ? 120000 : rate.remaining < 500 ? 30000 : PR_FRESH_MS;
};
const REVIEW_CHECK_MS = 2 * 60000;
const AUTO_FIX_MS = 2 * 60000;
const MEMBER = ["OWNER", "MEMBER", "COLLABORATOR"];
const THREADS = `query($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    reviews(last: 30) { nodes { id state body url authorAssociation author { __typename login } reactions(first: 20) { nodes { content user { login } } } } }
    reviewThreads(first: 100) { nodes {
    id isResolved path line
    comments(first: 30) { nodes { id body url authorAssociation author { __typename login } reactions(first: 20) { nodes { content user { login } } } } }
  } } } }
}`;

function failedCheck(e) {
  if (e.__typename === "StatusContext") return !["SUCCESS", "PENDING", "EXPECTED"].includes(e.state);
  return e.status === "COMPLETED" && !["SUCCESS", "NEUTRAL", "SKIPPED", "CANCELLED", "STALE"].includes(e.conclusion);
}

const isReviewBot = (author) => author?.__typename === "Bot";
const AUTOFIX_DIR = () => `${appHome()}/data/autofix`;
const AUTOFIX_ROUNDS = 5;

const requiredCache = {};
async function requiredChecks(repo, base, cwd, on) {
  const key = `${repo}@${base}`;
  const cached = requiredCache[key];
  if (cached && Date.now() - cached.at < 6 * 60 * 60000) return cached.names;
  const r = await exec("gh", ["api", `repos/${repo}/rules/branches/${encodeURIComponent(base)}`], { cwd, on }).catch(() => null);
  const names = r?.code === 0 ? JSON.parse(r.stdout).filter((x) => x.type === "required_status_checks").flatMap((x) => (x.parameters?.required_status_checks ?? []).map((c) => c.context)) : [];
  requiredCache[key] = { names: [...new Set(names)], at: Date.now() };
  return requiredCache[key].names;
}

async function autoFixState(cwd, on) {
  const r = await exec("gh", ["pr", "view", "--json", "number,url,state,isDraft,headRefOid,baseRefName,mergeable,statusCheckRollup"], { cwd, on });
  if (r.code !== 0) return null;
  const view = JSON.parse(r.stdout);
  const latest = new Map();
  for (const e of view.statusCheckRollup ?? []) {
    const key = e.__typename === "StatusContext" ? `status:${e.context}` : `${e.workflowName ?? ""}:${e.name}`;
    const current = latest.get(key);
    if (!current || (e.startedAt ?? "") >= (current.startedAt ?? "")) latest.set(key, e);
  }
  const [, owner, name, number] = view.url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/) ?? [];
  const required = await requiredChecks(`${owner}/${name}`, view.baseRefName, cwd, on);
  const failedEntries = [...latest.entries()].filter(([, e]) => failedCheck(e));
  const requiredFailing = failedEntries.filter(([, e]) => required.includes(e.name ?? e.context)).map(([, e]) => e.name ?? e.context);
  const counted = required.length && !requiredFailing.length ? [] : failedEntries;
  const failing = counted.map(([key, e]) => ({ key: `${view.headRefOid}:${key}`, line: `- ${e.workflowName ? `${e.workflowName} / ` : ""}${e.name ?? e.context}${required.includes(e.name ?? e.context) ? " (required)" : ""}${e.detailsUrl ?? e.targetUrl ? ` (${e.detailsUrl ?? e.targetUrl})` : ""}` }));
  const requiredPending = required.length ? [...latest.values()].some((e) => required.includes(e.name ?? e.context) && (e.__typename === "StatusContext" ? e.state === "PENDING" || e.state === "EXPECTED" : e.status !== "COMPLETED")) : null;
  const pending = [...latest.values()].some((e) => (e.__typename === "StatusContext" ? e.state === "PENDING" || e.state === "EXPECTED" : e.status !== "COMPLETED"));
  let threads = [];
  let unresolved = null;
  const g = await exec("gh", ["api", "graphql", "-f", `query=${THREADS}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${number}`], { cwd, on }).catch(() => null);
  if (g?.code === 0) {
    const data = JSON.parse(g.stdout).data;
    const me = data.viewer.login;
    unresolved = data.repository.pullRequest.reviewThreads.nodes.filter((thread) => !thread.isResolved).length;
    threads = data.repository.pullRequest.reviewThreads.nodes.flatMap((thread) => {
      const all = thread.comments.nodes;
      const first = all[0];
      if (thread.isResolved || !first) return [];
      const login = first.author?.login ?? "ghost";
      const origin = login === me ? "you" : isReviewBot(first.author) ? "bot" : MEMBER.includes(first.authorAssociation) ? "human" : null;
      if (!origin) return [];
      const reactions = (first.reactions?.nodes ?? []).filter((x) => x.user?.login === me).map((x) => x.content);
      if (reactions.includes("THUMBS_DOWN") || reactions.includes("CONFUSED")) return [];
      const reply = [...all.slice(1)].reverse().find((c) => c.author?.login === me) ?? null;
      const last = all[all.length - 1];
      if (origin !== "you" && last.author?.login === me && !reply) return [];
      const signal = origin === "you" ? "your own comment" : reply ? `your reply: ${reply.body.replace(/\s+/g, " ").slice(0, 300)}` : reactions.includes("THUMBS_UP") ? "your 👍" : null;
      return [{ key: `${thread.id}:${last.id}`, thread: thread.id, comment: first.id, origin, author: login, path: thread.path, line: thread.line, body: first.body, url: first.url, signal }];
    });
    for (const review of data.repository.pullRequest.reviews?.nodes ?? []) {
      const login = review.author?.login ?? "ghost";
      const body = (review.body ?? "").replace(/\n-{3,}\n_Was this review helpful[\s\S]*$/, "").trim();
      if (!body || login === me || review.state === "APPROVED" || review.state === "DISMISSED") continue;
      const origin = isReviewBot(review.author) ? "bot" : MEMBER.includes(review.authorAssociation) ? "human" : null;
      if (!origin) continue;
      if (origin === "bot" && !/\*\*(🔴|🟡|💬|🟣)/u.test(body)) continue;
      const reactions = (review.reactions?.nodes ?? []).filter((x) => x.user?.login === me).map((x) => x.content);
      if (reactions.length) continue;
      threads.push({ key: `review:${review.id}`, review: review.id, origin, author: login, body, url: review.url, signal: null });
    }
  }
  const conflict = view.mergeable === "CONFLICTING";
  const readyForReview = view.isDraft && !conflict && !failing.length && !(requiredPending ?? pending) && latest.size > 0 && unresolved === 0;
  return { ...view, failing, requiredFailing, threads, conflict, readyForReview };
}

function autoFixPrompt(state, parts) {
  const out = [`Auto-fix round for PR #${state.number} (${state.url}). Follow the herdr-app:pr-autofix skill.`];
  if (parts.conflict) out.push(`Merge conflicts with ${state.baseRefName}.`);
  if (parts.checks.length) out.push([
    `Failing checks on ${state.headRefOid.slice(0, 8)}:`,
    ...parts.checks.map((c) => c.line),
    ...(state.requiredFailing?.length ? [`Required checks that fail: ${state.requiredFailing.join(", ")}. Fix only what makes these fail. Checks that are not required may fail on their own; leave them alone.`] : []),
  ].join("\n"));
  if (parts.threads.length) out.push([`Review comments (${parts.threads.length}):`, ...parts.threads.flatMap((t) => [
    t.review
      ? `- [${t.origin}] review summary by @${t.author} — ${t.url} (review ${t.review})`
      : `- [${t.origin}] @${t.author}${t.path ? ` on ${t.path}${t.line ? `:${t.line}` : ""}` : ""} — ${t.url} (thread ${t.thread}, first comment ${t.comment})${t.signal ? ` — ${t.signal}` : ""}`,
    ...t.body.slice(0, 1200).split("\n").map((l) => `  > ${l}`),
  ])].join("\n"));
  return out.join("\n\n");
}

function setAutoFix(id, on) {
  const all = { ...map("pr.autoFix") };
  if (on) all[id] = { handled: [], rounds: 0 };
  else delete all[id];
  setShared("pr.autoFix", all);
  const status = { ...map("pr.autoFixStatus") };
  delete status[id];
  setShared("pr.autoFixStatus", status);
}
const DEFAULT_BRANCHES = new Set(["master", "main"]);
function inLayout(id) {
  const find = (node) => (node?.id === id ? node : (node?.children ?? []).map(find).find(Boolean));
  return Boolean(find(layout()));
}
function sidebarList() {
  const find = (node, id) => (node?.id === id ? node : (node?.children ?? []).map((c) => find(c, id)).find(Boolean));
  return find(layout(), "sidebar-lists")?.active ?? "sessions";
}
function listVisible() {
  const find = (node, id) => (node?.id === id ? node : (node?.children ?? []).map((c) => find(c, id)).find(Boolean));
  const lists = find(layout(), "sidebar-lists");
  return !lists || lists.type !== "stack" || (lists.active ?? "sessions") === "sessions";
}
const extensions = () => [...(shared("sidebar.extensions") ?? [])].sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
async function loadExtensions() {
  const r = await exec("sh", ["-c", 'for f in "$1"/mods/*/sidebar.json; do [ -f "$f" ] && { printf "%s\\n" "$f"; cat "$f"; printf "\\n\\036\\n"; }; done', "sh", appHome()]).catch(() => null);
  const list = [];
  for (const chunk of (r?.stdout ?? "").split("\u001e")) {
    const text = chunk.trim();
    if (!text) continue;
    const newline = text.indexOf("\n");
    try { list.push(JSON.parse(text.slice(newline + 1))); } catch {}
  }
  if (JSON.stringify(list) !== JSON.stringify(shared("sidebar.extensions") ?? [])) setShared("sidebar.extensions", list);
}
const TOOLS = { files: { name: "Files", script: "nvim ." }, changes: { name: "Changes", script: "lazygit" } };
export function toolPane(kind, s, ps = panes()) {
  const id = (shared("tools.panes") ?? {})[`${s?.id}|${kind}`];
  return id ? ps.find((p) => p.pane === id) ?? null : null;
}
const DEFAULT_SETTINGS = { settledDays: 7, branchPrefix: "", setup: {}, autoSettle: true, focusMute: false, focusWorking: true, tomorrowHour: 9, nextWeekDay: 1, autoToasts: false };
const conf = () => ({ ...DEFAULT_SETTINGS, ...(shared("firehouse.settings") ?? {}) });
const setConf = (change) => setShared("firehouse.settings", { ...(shared("firehouse.settings") ?? {}), ...change });
const autoNotify = (n) => (conf().autoToasts ? notify(n) : null);
const setupFor = (root) => (root ? (conf().setup?.[root] ?? "").trim() : "");
const dayAt = (days, hour, minute = 0) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, hour, minute).getTime(); };
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SNOOZE = [
  ["1h", "In 1 hour", () => Date.now() + 60 * 60000],
  ["3h", "In 3 hours", () => Date.now() + 3 * 60 * 60000],
  ["tomorrow", "Tomorrow", () => dayAt(1, conf().tomorrowHour)],
  ["week", "Next week", () => dayAt(((conf().nextWeekDay - new Date().getDay() + 7) % 7) || 7, conf().tomorrowHour)],
];
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function parseSnooze(text) {
  const value = text.trim().toLowerCase();
  if (!value) return null;
  const span = value.match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/);
  if (span) {
    const n = Number(span[1]);
    const unit = span[2][0];
    return Date.now() + n * (unit === "m" ? 60000 : unit === "h" ? 3600000 : 86400000);
  }
  const timed = value.match(/^(?:(tomorrow|tmr|[a-z]{3})[a-z]*\s+)?(\d{1,2})(?:[:h.](\d{2}))?\s*(am|pm)?$/);
  if (!timed) return null;
  let hour = Number(timed[2]);
  const minute = Number(timed[3] ?? 0);
  if (timed[4] === "pm" && hour < 12) hour += 12;
  if (timed[4] === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  const day = timed[1];
  if (!day) {
    const today = dayAt(0, hour, minute);
    return today > Date.now() ? today : dayAt(1, hour, minute);
  }
  if (day === "tomorrow" || day === "tmr") return dayAt(1, hour, minute);
  const target = WEEKDAYS.indexOf(day);
  if (target === -1) return null;
  return dayAt(((target - new Date().getDay() + 7) % 7) || 7, hour, minute);
}

function snoozeHint(until) {
  const d = new Date(until);
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(new Date().toDateString())) / 86400000);
  if (days === 0) return time;
  if (days === 1) return `tomorrow ${time}`;
  return `${DAY_NAMES[d.getDay()].slice(0, 3)} ${time}`;
}

const base = (path) => (path ?? "").replace(/\/+$/, "").split("/").pop() || "~";
const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
const map = (key) => shared(key) ?? {};
const newId = () => Math.random().toString(36).slice(2, 10);
const CLAUDE = "claude";
const MODELS = [[null, "Default model"], ["fable", "Fable"], ["opus", "Opus"], ["sonnet", "Sonnet"]];
const MODES = [["auto", "Auto"], ["plan", "Plan"], ["acceptEdits", "Accept edits"], ["manual", "Manual"]];
const BRANCH_PROMPT = "You name git branches for a developer. Reply with only 2 to 5 lowercase English words joined by hyphens that say what the change does, for example rename-ci-test-databases. Never more than 5 words. Start with a ticket ID like pla-2525 when the request names one; it does not count as a word. Never use the names of repositories or folders where the work happens. No filler words, no prefix, no quotes.";
const FILLER = new Set(["a", "an", "the", "in", "on", "at", "of", "to", "for", "from", "with", "by", "and", "or", "is", "are", "be", "it", "this", "that", "i", "we", "you", "me", "my", "can", "could", "would", "should", "please", "need", "want", "like", "let", "lets", "just", "some", "also", "how", "what", "why", "do", "does", "under", "into", "folder", "repo", "hey", "hi", "ok", "maybe", "try", "help"]);
const START_SCRIPT = `#!/bin/sh
FOLDER="$1"; BRANCH="$2"; MESSAGE_FILE="$3"; WORKTREE="$4"; SETUP="$5"; shift 5
cd "$FOLDER" || exit 1
NOTE=""
if [ "$WORKTREE" = 1 ] || [ "$WORKTREE" = 2 ]; then
  if [ "$WORKTREE" = 1 ]; then
    DEFAULT=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##'); DEFAULT=\${DEFAULT:-master}
    printf '\\033[2mUpdating %s…\\033[0m\\n' "$DEFAULT"
    if git fetch --no-tags -q origin "$DEFAULT"; then
      if [ "$(git branch --show-current)" = "$DEFAULT" ]; then git merge -q --ff-only "origin/$DEFAULT" || true; else git fetch -q . "origin/$DEFAULT:$DEFAULT" || true; fi
    else
      printf 'Could not update %s, using the local copy.\\n' "$DEFAULT"
    fi
    printf '\\033[2mCreating the worktree %s…\\033[0m\\n' "$BRANCH"
    OUT=$(command wt switch "$BRANCH" --create \${HERDR_BASE:+--base "$HERDR_BASE"} --no-cd --format json -y 2>&1) || { printf '%s\\n' "$OUT"; exit 1; }
  else
    printf '\\033[2mChecking out %s…\\033[0m\\n' "$BRANCH"
    OUT=$(command wt switch "$BRANCH" --no-cd --format json -y 2>&1) || { printf '%s\\n' "$OUT"; exit 1; }
  fi
  DIR=$(printf '%s\\n' "$OUT" | grep '^{' | tail -1 | jq -r .path)
  cd "$DIR" || exit 1
  if [ -n "$SETUP" ]; then
    LOG="\${TMPDIR:-/tmp}/herdr-setup-$$.log"
    (sh -c "$SETUP" > "$LOG" 2>&1 &)
    NOTE="<system-note>The worktree setup command ($SETUP) is still running in the background, logging to $LOG. Reading and editing code is fine, but tests, bundle, yarn and git commit hooks may fail until it finishes. If one fails for a missing dependency, say so and wait instead of working around it.</system-note>

"
  fi
fi
TEXT=$(cat "$MESSAGE_FILE" 2>/dev/null)
rm -f "$MESSAGE_FILE"
[ -z "$TEXT" ] && exec claude "$@"
exec claude "$@" "$NOTE$TEXT"
`;

function fallbackSlug(text) {
  const words = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((w) => w && !FILLER.has(w));
  return words.slice(0, 4).join("-").slice(0, 40).replace(/-+$/, "") || "session";
}

async function shellRun(script, args) {
  const shell = await exec("sh", ["-c", 'dscl . -read "/Users/$USER" UserShell 2>/dev/null | awk \'{print $2}\'']).catch(() => null);
  return exec(shell?.stdout.trim() || "/bin/zsh", ["-ilc", script, "sh", ...args]);
}

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

const WELCOME_TOOLS = [
  ["wt", "command -v wt", "Creates the worktree of each new session.", "brew install worktrunk"],
  ["gh", "gh auth status", "Pull requests, auto-fix and merge when ready.", "brew install gh, then gh auth login"],
  ["claude", "command -v claude", "Runs in every session.", "npm install -g @anthropic-ai/claude-code"],
  ["nvim", "command -v nvim", "Files (⌘E) opens Neovim beside Claude.", "brew install neovim ripgrep fd tree-sitter-cli, then git clone https://github.com/LazyVim/starter ~/.config/nvim"],
  ["lazygit", "command -v lazygit", "Changes (⌥⌘C) opens lazygit beside Claude.", "brew install lazygit"],
];
const WELCOME_SKILLS = ["pr-autofix", "spin-off"];

async function branchSlug(text, folder) {
  const repo = base(folder).toLowerCase().split(/[^a-z0-9]+/);
  try {
    const r = await shellRun('claude -p --model haiku "$1" < /dev/null', [`${BRANCH_PROMPT}\n\n<request>\n${text.slice(0, 1600)}\n</request>\n\nBranch:`]);
    const slug = r.code === 0 ? r.stdout.trim().split("\n").pop().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") : "";
    const words = slug.split("-").filter((w) => w && !repo.includes(w));
    if (words.length && words.length <= 7 && slug.length <= 48) return words.join("-");
  } catch {}
  return fallbackSlug(text);
}

let composerKeysBound = false;

async function ensureStartScript() {
  const dir = `${appHome()}/data/new-session`;
  await exec("mkdir", ["-p", dir]);
  const scriptPath = `${dir}/start.sh`;
  const current = await readTextFile(scriptPath).catch(() => null);
  if (current !== START_SCRIPT) await writeTextFile(scriptPath, START_SCRIPT, current);
  return { dir, scriptPath };
}

const SPINOFF_DIR = () => `${appHome()}/data/spinoff`;

async function spinOff(req) {
  const cwd = (req.cwd ?? "").replace(/\/+$/, "");
  const brief = (req.brief ?? "").trim();
  if (!cwd || !brief) throw new Error("A spin-off needs the source folder (cwd) and a brief.");
  const common = await exec("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (common.code !== 0) throw new Error(`${cwd} is not in a git repo.`);
  const root = common.stdout.trim().replace(/\/\.git\/?$/, "");
  const current = (await exec("git", ["-C", cwd, "branch", "--show-current"])).stdout.trim();
  const stack = req.base === "stack" && current ? current : "";
  const ps = panes();
  const source = spaces().find((sp) => place(sp, ps).replace(/\/+$/, "") === cwd) ?? null;
  const sourceName = source?.name ?? base(cwd);
  const name = sessionName(req.title || brief);
  const branch = `${conf().branchPrefix}${await branchSlug(name, root)}-${Math.random().toString(16).slice(2, 6)}`;
  const note = [
    `This session was spun off from the session "${sourceName}" (worktree ${cwd}). You work in a new worktree (your current folder) on branch ${branch}, based on ${stack || "the default branch"}.`,
    `Do not edit files in ${cwd}: it belongs to the other session.`,
    stack ? `If you open a pull request, use ${stack} as its base branch.` : "",
  ].filter(Boolean).join(" ");
  const { dir, scriptPath } = await ensureStartScript();
  const messagePath = `${dir}/${newId()}.txt`;
  await writeTextFile(messagePath, brief, null);
  const previous = spaces().find((sp) => sp.active)?.id ?? null;
  const focus = Boolean(shared("focus.on")) || Boolean(source && map("focus.starred")[source.id]);
  setShared("sessions.pending", [...(shared("sessions.pending") ?? []), { name, section: source ? (map("sessions.membership")[source.id] ?? null) : null, focus, at: Date.now() }]);
  run("space.new", { name, folder: root, machine: source?.machine ?? "", argv: ["env", `HERDR_BASE=${stack}`, "sh", scriptPath, root, branch, messagePath, "1", setupFor(root), "--permission-mode", req.mode || "auto", "--append-system-prompt", note] });
  if (previous) run("space.select", { id: previous });
  autoNotify({ title: `Spun off “${name}”`, body: stack ? `${branch}, stacked on ${stack}` : branch, level: "success", timeout: 5000 });
}
const PR_LINK = /https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/;

function sessionName(text) {
  const line = text.split("\n")[0].trim();
  return line.length > 48 ? `${line.slice(0, 47).trimEnd()}…` : line;
}

async function latestConversation(cwd) {
  const dir = `${home()}/.claude/projects/${cwd.replace(/[^A-Za-z0-9]/g, "-")}`;
  const r = await exec("sh", ["-c", 'ls -t "$1"/*.jsonl 2>/dev/null | head -1', "sh", dir]).catch(() => null);
  const file = r?.code === 0 ? r.stdout.trim() : "";
  return file ? base(file).replace(/\.jsonl$/, "") : null;
}

const settledDays = () => conf().settledDays;

const allSettled = () => shared("sessions.archive") ?? [];
const expired = (entry) => Date.now() - entry.settledAt >= settledDays() * 24 * 60 * 60 * 1000;

function archived() {
  return allSettled().filter((entry) => !expired(entry) || entry.kept);
}

async function cleanUpSettled(entry) {
  const cwd = (entry.cwd ?? "").replace(/\/+$/, "");
  const exists = cwd ? (await exec("test", ["-d", cwd]).catch(() => null))?.code === 0 : false;
  if (exists) {
    const dirs = await exec("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"]).catch(() => null);
    if (dirs?.code === 0) {
      const [dir, common] = dirs.stdout.trim().split("\n");
      if (dir !== common) {
        if ((await exec("git", ["-C", cwd, "status", "--porcelain"])).stdout.trim()) return "uncommitted changes";
        if ((await exec("git", ["-C", cwd, "log", "--oneline", "-n", "1", "HEAD", "--not", "--remotes"])).stdout.trim()) return "commits that are not on GitHub";
        const removed = await exec("git", ["-C", common.replace(/\/\.git\/?$/, ""), "worktree", "remove", cwd]);
        if (removed.code !== 0) return (removed.stderr || removed.stdout).trim().split("\n")[0] || "git worktree remove failed";
      }
    }
  }
  if (entry.claude && cwd) {
    const live = map("sessions.claude");
    const inUse = spaces().some((sp) => live[sp.id] === entry.claude) || allSettled().some((other) => other.key !== entry.key && other.claude === entry.claude && !expired(other));
    if (!inUse) {
      const dir = `${home()}/.claude/projects/${cwd.replace(/[^A-Za-z0-9]/g, "-")}`;
      await exec("rm", ["-rf", `${dir}/${entry.claude}.jsonl`, `${dir}/${entry.claude}`]);
      await exec("rmdir", [dir]).catch(() => null);
    }
  }
  return null;
}

async function forgetSettled(entry) {
  const kept = await cleanUpSettled(entry);
  if (kept) {
    setShared("sessions.archive", allSettled().map((other) => (other.key === entry.key ? { ...other, kept } : other)));
    return kept;
  }
  setShared("sessions.archive", allSettled().filter((other) => other.key !== entry.key));
  return null;
}


const PR_QUEUE = `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) {
  id state isDraft mergeable mergeStateStatus reviewDecision isMergeQueueEnabled isInMergeQueue autoMergeRequest { enabledAt } baseRefName
  repository { defaultBranchRef { name } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
} } }`;

async function queueState(url, cwd, machine) {
  const [, owner, name, number] = url.match(PR_LINK) ?? [];
  const r = await exec("gh", ["api", "graphql", "-f", `query=${PR_QUEUE}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${number}`], { cwd, on: machine ?? undefined });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
  const pr = JSON.parse(r.stdout).data.repository.pullRequest;
  const base = pr.repository?.defaultBranchRef?.name;
  return { ...pr, checks: pr.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null, stacked: Boolean(base) && pr.baseRefName !== base, defaultBranch: base };
}

function autoFixBusy(id) {
  const config = map("pr.autoFix")[id];
  if (!config) return false;
  if (config.paused) return true;
  const status = map("pr.autoFixStatus")[id];
  if (status?.state === "needs_you") return true;
  return Boolean(config.round) && (!status || status.at < config.round.at);
}

const mergeWaiting = (id) => map("pr.mergeWhenReady")[id] ?? null;

async function setAutoMerge(entry, on) {
  const url = entry.pr?.url;
  if (!url) return;
  const gh = (args) => exec("gh", args, { cwd: entry.cwd, on: entry.machine ?? undefined });
  const waiting = { ...map("pr.mergeWhenReady") };
  if (!on) {
    if (waiting[entry.id]) {
      delete waiting[entry.id];
      setShared("pr.mergeWhenReady", waiting);
    }
    if (entry.pr?.autoMergeRequest) await gh(["pr", "merge", url, "--disable-auto"]);
  } else {
    const pr = await queueState(url, entry.cwd, entry.machine);
    if (pr.stacked) throw new Error(`This PR is stacked on ${pr.baseRefName}. Merge when ready works only for PRs based on ${pr.defaultBranch}. Merge the PR below it first.`);
    if (pr.isMergeQueueEnabled) {
      waiting[entry.id] = { url, cwd: entry.cwd, machine: entry.machine ?? null, state: "waiting", at: Date.now() };
      setShared("pr.mergeWhenReady", waiting);
      return;
    }
    const method = ((await gh(["repo", "view", "--json", "viewerDefaultMergeMethod", "--jq", ".viewerDefaultMergeMethod"])).stdout ?? "").trim();
    const r = await gh(["pr", "merge", url, "--auto", method === "SQUASH" ? "--squash" : method === "REBASE" ? "--rebase" : "--merge"]);
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
  }
  const prs = { ...map("sessions.prs") };
  for (const [key, value] of Object.entries(prs)) if (value?.pr?.url === url) prs[key] = { ...value, pr: { ...value.pr, autoMergeRequest: on ? { enabledAt: new Date().toISOString() } : null } };
  setShared("sessions.prs", prs);
}

function request(job) {
  setShared("sessions.requests", [...(shared("sessions.requests") ?? []), { ...job, at: Date.now() }]);
  run("sessions.requests");
}

async function settleSession(entry) {
  const claude = map("sessions.claude")[entry.id] ?? (await latestConversation(entry.cwd));
  const pr = entry.pr ? { number: entry.pr.number, title: entry.pr.title, state: entry.pr.state, isDraft: entry.pr.isDraft, url: entry.pr.url } : null;
  setShared("sessions.archive", [{ key: newId(), name: entry.name, folderKey: entry.folderKey, cwd: entry.cwd, branch: entry.branch ?? null, pr, claude, section: map("sessions.membership")[entry.id] ?? null, focused: Boolean(map("focus.starred")[entry.id]), settledAt: Date.now() }, ...archived()]);
  run("space.close", { id: entry.id, confirmed: true });
}

function restoreSession(entry) {
  setShared("sessions.archive", allSettled().filter((other) => other.key !== entry.key));
  setShared("sessions.pending", [...(shared("sessions.pending") ?? []), { name: entry.name, section: entry.section, focus: entry.focused, claude: entry.claude, at: Date.now() }]);
  run("space.new", { name: entry.name, folder: entry.cwd, argv: entry.claude ? [CLAUDE, "--resume", entry.claude] : [CLAUDE] });
}

function mainCheckoutNote(repo) {
  return `You are working in the main checkout of ${repo}, which must stay on its default branch (main or master). Do not create, switch or check out branches here: no git checkout, git switch, git worktree or gh pr checkout in this folder. If the work needs a branch, stop and ask the developer to start a new worktree session for it instead.`;
}

function claudePane(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((t) => t.id));
  return ps.find((p) => tabs.has(p.tab) && p.terminal && (p.program?.key === "claude" || /claude/i.test(p.app ?? "")));
}

function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((t) => t.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || home();
}

function age(iso) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  return d < 3600 ? `${Math.max(1, Math.round(d / 60))}m` : d < 86400 ? `${Math.round(d / 3600)}h` : d < 86400 * 60 ? `${Math.round(d / 86400)}d` : `${Math.round(d / 86400 / 30)}mo`;
}

function clock(until) {
  const d = new Date(until);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

export function snoozed(id, now = Date.now()) {
  return Boolean(map("focus.untilReview")[id]) || (map("focus.snoozed")[id] ?? 0) > now;
}

function snoozeLabel(id) {
  return map("focus.untilReview")[id] ? "approved or commented" : snoozeHint(map("focus.snoozed")[id]);
}

export function hidden(id, now = Date.now()) {
  return Boolean(shared("focus.on")) && (id === shared("sessions.dev") || !map("focus.starred")[id] || snoozed(id, now));
}

const pinned = (id) => Boolean(map("focus.pinned")[id]);

function setPinned(id, on) {
  const all = { ...map("focus.pinned") };
  if (on) all[id] = true;
  else delete all[id];
  setShared("focus.pinned", all);
}

function workingFor(s) {
  const since = (s.tabs ?? []).map((tab) => tab.working_since).filter(Boolean);
  if (!since.length) return "";
  const minutes = Math.max(1, Math.round((Date.now() - Math.min(...since)) / 60000));
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function star(id, on) {
  if (on && id === shared("sessions.dev")) return;
  const starred = { ...map("focus.starred") };
  if (on) starred[id] = true;
  else delete starred[id];
  setShared("focus.starred", starred);
  if (!on) snooze(id, null);
}

const snoozeSession = (id, until) => snooze(id, until);
function snooze(id, until) {
  const all = { ...map("focus.snoozed") };
  const review = { ...map("focus.untilReview") };
  delete all[id];
  delete review[id];
  if (until === "review") review[id] = { baseline: null, at: Date.now() };
  else if (until) all[id] = until;
  setShared("focus.snoozed", all);
  setShared("focus.untilReview", review);
}

function wakeForYou(id) {
  if (!snoozed(id)) return;
  snooze(id, null);
  const space = spaces().find((sp) => sp.id === id);
  if (shared("focus.on") && !hidden(id) && !space?.active) playSound("blocked");
}

function moveTo(id, sectionId) {
  const membership = { ...map("sessions.membership") };
  if (sectionId) membership[id] = sectionId;
  else delete membership[id];
  setShared("sessions.membership", membership);
}

async function setSounds(enabled) {
  const path = `${appHome()}/settings.json`;
  const text = await readTextFile(path);
  const settings = text ? JSON.parse(text) : {};
  if ((settings.sounds?.enabled ?? true) === enabled) return;
  settings.sounds = { ...(settings.sounds ?? {}), enabled };
  await writeTextFile(path, `${JSON.stringify(settings, null, 2)}\n`, text);
}

async function syncSounds() {
  const before = shared("focus.soundsBefore");
  if (conf().focusMute && shared("focus.on")) {
    if (before == null) {
      const text = await readTextFile(`${appHome()}/settings.json`);
      setShared("focus.soundsBefore", text ? (JSON.parse(text).sounds?.enabled ?? true) : true);
    }
    await setSounds(false);
  } else if (before != null) {
    await setSounds(before);
    setShared("focus.soundsBefore", undefined);
  }
}

async function setFocus(on) {
  setShared("focus.on", on);
  await syncSounds();
}

function prState(pr) {
  if (!pr) return null;
  if (pr.state === "MERGED") return "merged";
  if (pr.state === "CLOSED") return "closed";
  return pr.isDraft ? "draft" : "open";
}

function review(pr, t) {
  if (!pr || pr.state !== "OPEN" || pr.isDraft) return null;
  if (pr.reviewDecision === "APPROVED") return ["Approved", t.done];
  if (pr.reviewDecision === "CHANGES_REQUESTED") return ["Changes requested", t.ansi1];
  return ["Review", t.dim];
}

const openWelcome = () => openOverlay({ mod: "sessions", kind: "dialog", width: 620, height: 700, props: { welcome: true } });

export default class Sessions extends View {
  init(_props, cx) {
    if (props()?.bar) return initBar(this);
    if (props()?.pr) { this.panel = new PullRequestPanel(); return this.panel.init(_props, cx); }
    if (props()?.header) {
      cx.timer.every(2000, (cx) => cx.notify());
      cx.spawn(async (cx) => {
        for (;;) {
          const command = await nextCommand();
          if (listVisible()) continue;
          if (command.startsWith("ext-")) this.toggleExtension(command.slice(4));
          else if (command === "focus") await this.focusPressed();
          else if (command === "chats") this.toggleChats();
          else setShared("sessions.forward", { command, at: Date.now() });
          cx.notify();
        }
      });
      return;
    }
    if (props()?.composer) return this.initComposer(cx);
    if (props()?.menu?.snoozeOnly) return this.initSnooze(cx);
    if (props()?.menu?.folderMenu) return this.initFolderMenu(cx);
    if (props()?.welcome) return this.initWelcome(cx);
    if (props()?.menu) {
      const entry = props().menu.entry;
      if (entry?.branch && !entry.pr?.baseRefName && entry.cwd) cx.spawn(async (cx) => {
        const r = await exec("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd: entry.cwd, on: entry.machine ?? undefined }).catch(() => null);
        this.defaultBranch = r?.code === 0 ? r.stdout.trim().replace(/^origin\//, "") : null;
        cx.notify();
      });
      return;
    }
    this.git = {};
    this.checked = {};
    this.collapsed = new Set(JSON.parse(localStorage.getItem("folders.collapsed") ?? "[]"));
    this.known = new Set(spaces().map((s) => s.id));
    this.statuses = Object.fromEntries(spaces().map((s) => [s.id, s.status]));
    this.pressed = null;
    this.over = null;
    this.editing = null;
    cx.spawn(async (cx) => { await syncSounds(); cx.notify(); });
    if (JSON.stringify(shared("settings.defaults")) !== JSON.stringify(DEFAULT_SETTINGS)) setShared("settings.defaults", DEFAULT_SETTINGS);
    this.focusMute = conf().focusMute;
    cx.spawn(async () => loadExtensions());
    cx.timer.every(60000, () => { loadExtensions(); });
    this.forwardedAt = Date.now();
    cx.timer.every(250, (cx) => {
      const job = shared("sessions.forward");
      if (!job || job.at <= this.forwardedAt) return;
      this.forwardedAt = job.at;
      this.command(job.command, cx);
      cx.notify();
    });
    if (!shared("sessions.welcomed")) cx.timer.after(1500, () => { setShared("sessions.welcomed", true); openWelcome(); });
    this.refreshGit(cx);
    cx.timer.every(2000, (cx) => {
      if (conf().focusMute !== this.focusMute) { this.focusMute = conf().focusMute; syncSounds(); }
      this.refreshGit(cx);
      this.autoSettle(cx);
      this.runRequests(cx);
      this.runSpinoffs(cx);
    });
    cx.timer.every(PR_FRESH_MS, (cx) => this.refreshPullRequests(cx));
    cx.timer.every(REVIEW_CHECK_MS, (cx) => this.checkReviews(cx));
    cx.timer.every(AUTO_FIX_MS, (cx) => { this.runAutoFix(cx); this.runMergeWhenReady(cx); });
    cx.timer.every(5000, (cx) => this.readAutoFixStatus(cx));
    cx.timer.after(20000, (cx) => this.purgeSettled(cx));
    cx.timer.every(10 * 60000, (cx) => this.purgeSettled(cx));
    cx.timer.every(30000, (cx) => cx.notify());
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") await this.focusPressed();
        else this.command(command, cx);
        cx.notify();
      }
    });
  }

  where(s, ps) {
    return JSON.stringify([s.machine ?? null, map("sessions.repoOf")[s.id] ?? place(s, ps)]);
  }

  checkMainCheckouts(cx, force = false) {
    if (this.checkingMains || (!force && Date.now() - (this.mainsCheckedAt ?? 0) < GIT_REFRESH_MS)) return;
    this.checkingMains = true;
    this.mainsCheckedAt = Date.now();
    const ps = panes();
    const keys = [...new Set([...spaces().map((sp) => this.info(sp, ps).folderKey), ...(shared("sessions.folders") ?? [])])].filter((key) => JSON.parse(key)[1] !== home());
    cx.spawn(async (cx) => {
      this.mains ??= {};
      for (const key of keys) {
        const [on, path] = JSON.parse(key);
        try {
          const branch = (await exec("git", ["branch", "--show-current"], { cwd: path, on })).stdout.trim();
          const def = (await exec("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd: path, on })).stdout.trim().replace(/^origin\//, "");
          const dirty = Boolean((await exec("git", ["--no-optional-locks", "status", "--porcelain", "--untracked-files=no"], { cwd: path, on })).stdout.trim());
          this.mains[key] = { branch, def, dirty };
        } catch {}
      }
      this.checkingMains = false;
      cx.notify();
    });
  }

  switchToDefault(key, cx) {
    const [on, path] = JSON.parse(key);
    const main = this.mains?.[key];
    if (!main?.def) return;
    cx.spawn(async (cx) => {
      const switched = await exec("git", ["switch", main.def], { cwd: path, on }).catch((e) => ({ code: 1, stderr: e.message }));
      if (switched.code !== 0) notify({ title: `Could not switch ${base(path)} to ${main.def}`, body: (switched.stderr || switched.stdout).trim(), level: "error" });
      else {
        const pulled = await exec("git", ["pull", "-q", "--ff-only", "origin", main.def], { cwd: path, on }).catch((e) => ({ code: 1, stderr: e.message }));
        if (pulled.code !== 0) notify({ title: `${base(path)} is on ${main.def}, but not up to date`, body: (pulled.stderr || pulled.stdout).trim().split("\n").slice(-2).join(" "), level: "warning" });
      }
      this.checkMainCheckouts(cx, true);
    });
  }

  refreshGit(cx) {
    this.checkMainCheckouts(cx);
    if (this.refreshing) return;
    const ps = panes();
    const now = Date.now();
    const due = [...new Set(spaces().map((s) => this.where(s, ps)))].filter((k) => !(k in this.git) || (window().active && now - (this.checked[k] ?? 0) > GIT_REFRESH_MS));
    this.watchStatuses();
    if (!due.length) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      for (const key of due) await this.check(key);
      this.refreshing = false;
      this.refreshPullRequests(cx);
      cx.notify();
    });
  }

  watchStatuses() {
    for (const s of spaces()) {
      const before = this.statuses[s.id];
      if (s.status !== before && s.status === "blocked" && snoozed(s.id)) wakeForYou(s.id);
      else if (s.status !== before && s.status === "blocked" && shared("focus.on") && !hidden(s.id) && !s.active) playSound("blocked");
      if (before === "working" && s.status !== "working") {
        const k = this.where(s, panes());
        delete this.checked[k];
      }
      this.statuses[s.id] = s.status;
    }
  }

  async check(key) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    try {
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
      if (top.code !== 0) {
        this.git[key] = null;
        return;
      }
      const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
      const branch = await exec("git", ["branch", "--show-current"], { cwd, on });
      const dir = common.stdout.trim();
      const root = dir.endsWith("/.git") ? dir.slice(0, -5) : top.stdout.trim();
      this.git[key] = { on, cwd, root, top: top.stdout.trim(), linked: dir !== `${top.stdout.trim()}/.git`, branch: branch.stdout.trim() || null };
    } catch {
      this.git[key] ??= null;
    }
  }

  prKey(g) {
    return `${g.on ?? ""}|${g.root}|${g.branch}`;
  }

  async repoOf(g) {
    this.remotes ??= {};
    const key = `${g.on ?? ""}|${g.root}`;
    if (key in this.remotes) return this.remotes[key];
    const r = await exec("git", ["remote", "get-url", "origin"], { cwd: g.root, on: g.on }).catch(() => null);
    const m = r?.code === 0 ? r.stdout.trim().match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?$/) : null;
    this.remotes[key] = m ? { owner: m[1], name: m[2] } : null;
    return this.remotes[key];
  }

  refreshPullRequests(cx) {
    if (this.prsRefreshing || Date.now() - (this.prsRefreshedAt ?? 0) < prInterval() - 500) return;
    const branches = [...new Map(Object.values(this.git).filter((g) => g?.branch && !DEFAULT_BRANCHES.has(g.branch)).map((g) => [this.prKey(g), g])).values()];
    if (!branches.length) return;
    this.prsRefreshing = true;
    cx.spawn(async (cx) => {
      try {
        const byMachine = new Map();
        for (const g of branches) {
          const repo = await this.repoOf(g);
          if (!repo) continue;
          if (!byMachine.has(g.on ?? "")) byMachine.set(g.on ?? "", []);
          byMachine.get(g.on ?? "").push({ g, repo });
        }
        const fields = "number title state isDraft url reviewDecision createdAt baseRefName autoMergeRequest { enabledAt }";
        let changed = false;
        for (const [on, items] of byMachine) {
          const query = `query { rateLimit { cost used remaining limit resetAt } ${items.map(({ g, repo }, i) => `b${i}: repository(owner: ${JSON.stringify(repo.owner)}, name: ${JSON.stringify(repo.name)}) { defaultBranchRef { name } pullRequests(headRefName: ${JSON.stringify(g.branch)}, first: 5, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { ${fields} } } }`).join(" ")} }`;
          const r = await exec("gh", ["api", "graphql", "-f", `query=${query}`], { on: on || undefined }).catch(() => null);
          if (r?.code !== 0) continue;
          const data = JSON.parse(r.stdout).data ?? {};
          if (data.rateLimit && !on) setShared("github.rateLimit", { ...data.rateLimit, at: Date.now() });
          const prs = { ...map("sessions.prs") };
          items.forEach(({ g }, i) => {
            const nodes = data[`b${i}`]?.pullRequests?.nodes;
            if (!nodes) return;
            const found = nodes.find((n) => n.state === "OPEN") ?? nodes[0] ?? null;
            const base = data[`b${i}`]?.defaultBranchRef?.name;
            const pr = found ? { ...found, stacked: Boolean(base) && found.baseRefName !== base } : null;
            const key = this.prKey(g);
            if (JSON.stringify(prs[key]?.pr ?? null) !== JSON.stringify(pr)) changed = true;
            prs[key] = { pr, at: Date.now() };
          });
          setShared("sessions.prs", prs);
        }
        if (changed) cx.notify();
      } finally {
        this.prsRefreshing = false;
        this.prsRefreshedAt = Date.now();
      }
    });
  }

  info(s, ps) {
    const g = this.git[this.where(s, ps)] ?? null;
    const pr = g?.branch ? (map("sessions.prs")[this.prKey(g)]?.pr ?? null) : null;
    const folder = g ? g.root : place(s, ps);
    const name = pr?.title ?? (s.named ? s.name : g?.linked && g.branch ? g.branch : s.name);
    return { s, g, pr, folder, folderKey: JSON.stringify([s.machine ?? null, folder]), name };
  }

  addFolders(keys) {
    const saved = shared("sessions.folders") ?? [];
    const next = [...new Set([...saved, ...keys])];
    if (next.length !== saved.length) setShared("sessions.folders", next);
  }

  active() {
    return spaces().find((space) => space.active) ?? null;
  }

  async focusPressed() {
    const elsewhere = this.chatsMode || this.activeView() !== "work";
    this.setChatsMode(false);
    if (elsewhere) {
      if (this.activeView() !== "work") this.showView("work");
      if (!shared("focus.on")) await setFocus(true);
      return;
    }
    await setFocus(!shared("focus.on"));
  }

  get chatsMode() {
    return !listVisible() && sidebarList() === "chats";
  }

  setChatsMode(on) {
    if (on !== this.chatsMode) run("layout.select", { stack: "sidebar-lists", child: on ? "chats" : "sessions" });
  }

  toggleChats() {
    const on = !(this.chatsMode && this.activeView() === "work");
    if (this.activeView() !== "work") this.showView("work");
    this.setChatsMode(on);
  }

  activeView() {
    const find = (node, id) => (node?.id === id ? node : (node?.children ?? []).map((c) => find(c, id)).find(Boolean));
    return find(layout(), "views")?.active ?? "work";
  }

  showView(id) {
    const ext = extensions().find((e) => e.view === id);
    run("layout.select", { stack: "views", child: id });
    run("layout.select", { stack: "sidebar-lists", child: ext?.sidebar ?? "sessions" });
  }

  toggleExtension(id) {
    const ext = extensions().find((e) => e.id === id);
    if (!ext) return;
    this.setChatsMode(false);
    this.showView(this.activeView() === ext.view ? "work" : ext.view);
  }

  runSpinoffs(cx) {
    this.spinning ??= new Set();
    cx.spawn(async (cx) => {
      const list = await exec("sh", ["-c", 'ls "$1"/*.json 2>/dev/null', "sh", SPINOFF_DIR()]).catch(() => null);
      const files = (list?.stdout ?? "").split("\n").map((line) => line.trim()).filter((path) => path && !this.spinning.has(path));
      for (const path of files) {
        this.spinning.add(path);
        try {
          const text = await readTextFile(path).catch(() => null);
          await exec("rm", ["-f", path]);
          if (text) await spinOff(JSON.parse(text));
        } catch (e) {
          notify({ title: "Could not spin off", body: e.message, level: "error" });
        } finally {
          this.spinning.delete(path);
        }
        cx.notify();
      }
    });
  }

  runRequests(cx) {
    const jobs = shared("sessions.requests") ?? [];
    if (!jobs.length) return;
    setShared("sessions.requests", []);
    for (const job of jobs) {
      if (Date.now() - job.at > 60000) continue;
      cx.spawn(async (cx) => {
        try {
          if (job.kind === "settle") await settleSession(job.entry);
          if (job.kind === "automerge") await setAutoMerge(job.entry, job.on);

        } catch (e) {
          notify({ title: job.kind === "automerge" ? "Could not change auto-merge" : "Could not settle", body: e.message, level: "error" });
        }
        cx.notify();
      });
    }
  }

  command(command, cx) {
    if (command.startsWith("ext-")) return this.toggleExtension(command.slice(4));
    if (command === "requests") return this.runRequests(cx);
    if (command === "spinoff") return this.runSpinoffs(cx);
    if (command === "new-chat") return run("chats.new");
    if (command === "chats") return this.toggleChats();
    if (command === "new-session") return this.openComposer();
    if (command === "dev") return this.openDev(cx);
    if (command === "settings") return openOverlay({ mod: "custom-settings", kind: "dialog", width: 620, height: 680 });
    if (command === "welcome") return openWelcome();
    if (command === "shortcuts") return openOverlay({ mod: "shortcuts", kind: "dialog", width: 880, height: 420 });
    const s = this.active();
    if (command === "next" || command === "prev") {
      const order = this.visibleOrder ?? [];
      if (!order.length) return;
      const index = s ? order.indexOf(s.id) : -1;
      const next = index === -1 ? (command === "next" ? 0 : order.length - 1) : Math.min(Math.max(index + (command === "next" ? 1 : -1), 0), order.length - 1);
      const target = spaces().find((space) => space.id === order[next]);
      if (target && target.id !== s?.id) {
        run("space.select", { id: target.id });
        this.openClaude(target, cx);
      }
      return;
    }
    if (!s) return;
    const ps = panes();
    const info = this.info(s, ps);
    const viewExt = command === "github" ? extensions().find((e) => e.view === this.activeView() && e.github) : null;
    if (viewExt) return run(viewExt.github);
    if (command === "github") {
      if (info.pr?.url) exec("open", [info.pr.url]);
    } else if (command === "files") {
      const key = `${s.id}|files`;
      const tabs = shared("tools.tabs") ?? {};
      const tab = s.tabs.find((x) => x.id === tabs[key]?.tab);
      const current = s.tabs.find((x) => x.active);
      if (tab && current?.id === tab.id) {
        const back = s.tabs.find((x) => x.id === tabs[key].back && x.id !== tab.id) ?? s.tabs.find((x) => x.id !== tab.id);
        if (back) run("tab.select", { id: back.id });
        return;
      }
      if (tab) {
        setShared("tools.tabs", { ...tabs, [key]: { ...tabs[key], back: current?.id ?? null } });
        run("tab.select", { id: tab.id });
        return;
      }
      const ps = panes();
      const folder = place(s, ps);
      const before = new Set(s.tabs.map((x) => x.id));
      cx.spawn(async (cx) => {
        const shell = await exec("sh", ["-c", 'dscl . -read "/Users/$USER" UserShell 2>/dev/null | awk \'{print $2}\'']).catch(() => null);
        run("tab.new", { space: s.id, name: "Files", folder, argv: [shell?.stdout.trim() || "/bin/zsh", "-ilc", "nvim ."] });
        for (let i = 0; i < 20; i++) {
          const added = spaces().find((x) => x.id === s.id)?.tabs.find((x) => !before.has(x.id));
          if (added) { setShared("tools.tabs", { ...(shared("tools.tabs") ?? {}), [key]: { tab: added.id, back: current?.id ?? null } }); break; }
          await new Promise((resolve) => cx.timer.after(100, resolve));
        }
      });
    } else if (command === "changes") {
      const ps = panes();
      const pane = toolPane(command, s, ps);
      if (pane) {
        if (ps.find((p) => p.focused)?.pane === pane.pane) run("pane.close", { pane: pane.pane });
        else run("pane.focus", { pane: pane.pane });
        return;
      }
      const folder = place(s, ps);
      const tab = s.tabs.find((x) => x.active)?.id;
      const before = new Set(ps.map((p) => p.pane));
      const key = `${s.id}|${command}`;
      cx.spawn(async (cx) => {
        const shell = await exec("sh", ["-c", 'dscl . -read "/Users/$USER" UserShell 2>/dev/null | awk \'{print $2}\'']).catch(() => null);
        run("terminal.open", { argv: [shell?.stdout.trim() || "/bin/zsh", "-ilc", TOOLS[command].script], folder, place: "right" });
        for (let i = 0; i < 20; i++) {
          const added = panes().find((p) => p.tab === tab && !before.has(p.pane));
          if (added) { setShared("tools.panes", { ...(shared("tools.panes") ?? {}), [key]: added.pane }); break; }
          await new Promise((resolve) => cx.timer.after(100, resolve));
        }
      });
    } else if (command === "pull-request") {
      const find = (node, id) => (node?.id === id ? node : (node?.children ?? []).map((c) => find(c, id)).find(Boolean));
      const root = layout();
      const panel = find(root, "panel");
      const body = find(root, "panel-body");
      if (panel && !panel.hidden && body?.active === command) run("layout.hide", { id: "panel" });
      else {
        run("layout.select", { stack: "panel-body", child: command });
        run("layout.show", { id: "panel" });
      }
    } else if (command === "rails") {
      const existing = s.tabs.find((tab) => tab.named && tab.name === "Rails console");
      if (existing) run("tab.select", { id: existing.id });
      else run("tab.new", { space: s.id, name: "Rails console", folder: place(s, ps), argv: ["bin/rails", "console"] });
    } else if (command === "new") {
      return this.openComposer();
    } else if (command === "new-worktree-dialog") {
      const root = info.g?.root;
      if (root) openOverlay({ mod: "worktree", kind: "dialog", width: 460, height: 420, props: { folder: root, machine: s.machine, action: "new", argv: [CLAUDE] } });
      else run("space.new", { argv: [CLAUDE] });
    }
  }

  async markReady(row, state) {
    if (!state.readyForReview || map("pr.readyFor")[row.s.id] === state.headRefOid) return;
    setShared("pr.readyFor", { ...map("pr.readyFor"), [row.s.id]: state.headRefOid });
    const ready = await exec("gh", ["pr", "ready", state.url], { cwd: row.g.top, on: row.g.on }).catch(() => null);
    if (ready?.code === 0) {
      const prs = { ...map("sessions.prs") };
      for (const [key, value] of Object.entries(prs)) if (value?.pr?.url === state.url) prs[key] = { ...value, pr: { ...value.pr, isDraft: false } };
      setShared("sessions.prs", prs);
      autoNotify({ title: `Ready for review: ${row.name}`, body: "Auto-fix is done: CI is green and every thread is resolved.", level: "success", timeout: 5000 });
    } else autoNotify({ title: `Could not mark ready: ${row.name}`, body: ((ready?.stderr || ready?.stdout) ?? "").trim(), level: "error" });
  }

  runMergeWhenReady(cx) {
    const waiting = map("pr.mergeWhenReady");
    if (!Object.keys(waiting).length || this.merging) return;
    this.merging = true;
    cx.spawn(async (cx) => {
      for (const [id, job] of Object.entries(waiting)) {
        const space = spaces().find((sp) => sp.id === id);
        const update = (change) => setShared("pr.mergeWhenReady", change ? { ...map("pr.mergeWhenReady"), [id]: { ...map("pr.mergeWhenReady")[id], ...change } } : Object.fromEntries(Object.entries(map("pr.mergeWhenReady")).filter(([key]) => key !== id)));
        try {
          const pr = await queueState(job.url, job.cwd, job.machine);
          if (pr.state !== "OPEN") { update(null); continue; }
          if (pr.isInMergeQueue) {
            if (autoFixBusy(id) || space?.status === "blocked") {
              const out = await exec("gh", ["api", "graphql", "-f", "query=mutation($id: ID!) { dequeuePullRequest(input: { id: $id }) { mergeQueueEntry { id } } }", "-f", `id=${pr.id}`], { cwd: job.cwd, on: job.machine ?? undefined }).catch(() => null);
              if (out?.code === 0) {
                update({ state: "waiting" });
                autoNotify({ title: `Left the merge queue: ${space?.name ?? job.url}`, body: "Auto-fix is working on it again. Herdr queues it back when auto-fix is done.", level: "info", action: { name: "space.select", args: { id } } });
              }
              continue;
            }
            if (job.state !== "queued") update({ state: "queued" });
            continue;
          }
          if (job.state === "queued" && (autoFixBusy(id) || space?.status === "blocked")) { update({ state: "waiting" }); continue; }
          if (job.state === "dropped") {
            const status = map("pr.autoFixStatus")[id];
            if (map("pr.autoFix")[id] && status?.state === "done" && status.at > (job.droppedAt ?? job.at)) update({ state: "waiting" });
            else continue;
          }
          if (job.state === "queued") {
            update({ state: "dropped", droppedAt: Date.now() });
            autoNotify({ title: `Left the merge queue: ${space?.name ?? job.url}`, body: "Look at the PR. Turn Merge when ready off and on to queue it again.", level: "error", action: { name: "space.select", args: { id } } });
            continue;
          }
          if (space?.status === "working" || space?.status === "blocked" || pr.stacked) continue;
          if (autoFixBusy(id)) continue;
          if (pr.isDraft || pr.mergeable !== "MERGEABLE" || pr.reviewDecision !== "APPROVED" || !["CLEAN", "UNSTABLE", "HAS_HOOKS"].includes(pr.mergeStateStatus)) continue;
          const r = await exec("gh", ["api", "graphql", "-f", "query=mutation($id: ID!) { enqueuePullRequest(input: { pullRequestId: $id }) { mergeQueueEntry { position } } }", "-f", `id=${pr.id}`], { cwd: job.cwd, on: job.machine ?? undefined });
          if (r.code === 0) update({ state: "queued" });
        } catch {}
      }
      this.merging = false;
      cx.notify();
    });
  }

  purgeSettled(cx) {
    if (this.purging) return;
    const due = allSettled().filter(expired);
    if (!due.length) return;
    this.purging = true;
    cx.spawn(async (cx) => {
      for (const entry of due) await forgetSettled(entry).catch(() => null);
      this.purging = false;
      cx.notify();
    });
  }

  readAutoFixStatus(cx) {
    const enabled = map("pr.autoFix");
    const ids = Object.keys(enabled);
    if (!ids.length) return;
    cx.spawn(async (cx) => {
      const status = { ...map("pr.autoFixStatus") };
      let changed = false;
      for (const id of ids) {
        const number = enabled[id].number;
        if (!number) continue;
        const text = await readTextFile(`${AUTOFIX_DIR()}/${number}.json`).catch(() => null);
        if (!text) continue;
        await exec("rm", ["-f", `${AUTOFIX_DIR()}/${number}.json`]);
        const report = JSON.parse(text);
        status[id] = { state: report.state === "needs_you" ? "needs_you" : "done", reason: report.reason ?? "", at: Date.now() };
        if (status[id].state === "needs_you") wakeForYou(id);
        changed = true;
      }
      if (changed) { setShared("pr.autoFixStatus", status); cx.notify(); }
    });
  }

  runAutoFix(cx) {
    const enabled = map("pr.autoFix");
    if (!Object.keys(enabled).length || this.fixing) return;
    this.fixing = true;
    cx.spawn(async (cx) => {
      const ps = panes();
      for (const [id, config] of Object.entries(enabled)) {
        const space = spaces().find((sp) => sp.id === id);
        if (!space || space.active || space.status === "working" || space.status === "blocked") continue;
        if (map("pr.autoFixStatus")[id]?.state === "needs_you" || config.paused) continue;
        const row = this.info(space, ps);
        if (!row.g) continue;
        const state = await autoFixState(row.g.top, row.g.on).catch(() => null);
        if (!state || state.state !== "OPEN") continue;
        const handled = new Set(config.handled ?? []);
        const conflict = state.conflict && !handled.has(`conflict:${state.headRefOid}`);
        const checks = state.failing.filter((x) => !handled.has(x.key));
        const threads = state.threads.filter((x) => !handled.has(x.key));
        const rounds = (config.rounds ?? 0) + (threads.length ? 1 : 0);
        const base = { ...config, number: state.number };
        if (threads.length && rounds > AUTOFIX_ROUNDS) {
          setShared("pr.autoFix", { ...map("pr.autoFix"), [id]: { ...base, paused: `${AUTOFIX_ROUNDS} rounds on review comments` } });
          autoNotify({ title: `Auto-fix paused: ${row.name}`, body: `It handled review comments ${AUTOFIX_ROUNDS} times. Look at the PR, then turn auto-fix off and on to continue.`, level: "warning" });
          continue;
        }
        if (!conflict && !checks.length && !threads.length) {
          if (config.number !== state.number) setShared("pr.autoFix", { ...map("pr.autoFix"), [id]: base });
          await this.markReady(row, state);
          continue;
        }
        if (conflict) handled.add(`conflict:${state.headRefOid}`);
        for (const x of checks) handled.add(x.key);
        for (const x of threads) handled.add(x.key);
        const kinds = [conflict ? "conflicts" : "", checks.length ? "CI" : "", threads.length ? "comments" : ""].filter(Boolean);
        setShared("pr.autoFix", { ...map("pr.autoFix"), [id]: { ...base, handled: [...handled].slice(-500), rounds, round: { kinds, at: Date.now() } } });
        const status = { ...map("pr.autoFixStatus") };
        delete status[id];
        setShared("pr.autoFixStatus", status);
        this.sendToClaude(space, autoFixPrompt(state, { conflict, checks, threads }));
      }
      this.fixing = false;
      cx.notify();
    });
  }

  autoFixMarker(s, t) {
    const config = map("pr.autoFix")[s.id];
    if (!config) return null;
    const status = map("pr.autoFixStatus")[s.id];
    if (config.paused || status?.state === "needs_you") return { color: t.blocked, tip: config.paused ? `Auto-fix paused: ${config.paused}` : `Auto-fix needs you: ${status.reason || "Claude asked a question"}` };
    const fresh = config.round && Date.now() - config.round.at < 3 * 60 * 60000;
    if (fresh && (s.status === "working" || Date.now() - config.round.at < 15000) && !status) return { color: t.working, tip: `Auto-fix is fixing ${config.round.kinds.join(", ")}` };
    return { color: t.dim, tip: status?.reason ? `Auto-fix is on. Last round: ${status.reason}` : "Auto-fix is on: Claude gets failing CI, conflicts and review comments when this session is idle. When all of it is fixed, Herdr marks the draft ready for review." };
  }

  sendToClaude(space, text) {
    const ps = panes();
    const claude = claudePane(space, ps);
    if (claude) {
      hc(["send", claude.terminal, text]);
      return;
    }
    const id = map("sessions.claude")[space.id];
    run("tab.new", { space: space.id, folder: place(space, ps), argv: id ? [CLAUDE, "--resume", id] : [CLAUDE], task: text });
  }

  checkReviews(cx) {
    const waiting = map("focus.untilReview");
    const ids = Object.keys(waiting);
    if (!ids.length || this.checkingReviews) return;
    this.checkingReviews = true;
    cx.spawn(async (cx) => {
      const ps = panes();
      for (const id of ids) {
        const space = spaces().find((sp) => sp.id === id);
        const row = space ? this.info(space, ps) : null;
        if (!row?.g) continue;
        const r = await exec("gh", ["pr", "view", "--json", "state,reviewDecision,reviews,comments"], { cwd: row.g.top, on: row.g.on }).catch(() => null);
        if (r?.code !== 0) continue;
        const pr = JSON.parse(r.stdout);
        const count = (pr.reviews?.length ?? 0) + (pr.comments?.length ?? 0);
        const entry = map("focus.untilReview")[id];
        if (!entry) continue;
        const reason = pr.reviewDecision === "APPROVED" ? "approved" : pr.state !== "OPEN" ? pr.state.toLowerCase() : entry.baseline !== null && count > entry.baseline ? "new review or comment" : null;
        if (!reason) {
          if (entry.baseline === null) setShared("focus.untilReview", { ...map("focus.untilReview"), [id]: { ...entry, baseline: count } });
          continue;
        }
        snooze(id, null);
        autoNotify({ title: `${row.name}: ${reason}`, body: "Back in focus.", level: "info", action: { name: "space.select", args: { id } } });
      }
      this.checkingReviews = false;
      cx.notify();
    });
  }

  autoSettle(cx) {
    if (machines().some((m) => m.layout !== "ready")) return;
    this.settling ??= new Set();
    const off = map("sessions.noAutoSettle");
    const seen = map("sessions.prOpenSeen");
    const ps = panes();
    for (const s of spaces()) {
      const row = this.info(s, ps);
      if (row.pr?.state === "OPEN" && seen[s.id] !== row.pr.number) setShared("sessions.prOpenSeen", { ...map("sessions.prOpenSeen"), [s.id]: row.pr.number });
      if (!conf().autoSettle || off[s.id] || this.settling.has(s.id) || s.status === "working" || s.status === "blocked") continue;
      if (!["MERGED", "CLOSED"].includes(row.pr?.state) || seen[s.id] !== row.pr.number) continue;
      this.settling.add(s.id);
      const entry = this.entry(row);
      cx.spawn(async () => settleSession(entry));
    }
  }

  openDev(cx) {
    const existing = spaces().find((space) => space.id === shared("sessions.dev"));
    if (existing) {
      if (this.activeView() !== "work") this.showView("work");
      run("space.select", { id: existing.id });
      this.openNewClaude(existing);
      return;
    }
    setShared("sessions.pending", [...(shared("sessions.pending") ?? []), { name: "Herdr config", dev: true, at: Date.now() }]);
    if (this.activeView() !== "work") this.showView("work");
    run("space.new", { name: "Herdr config", folder: appHome(), argv: [CLAUDE] });
  }

  openNewClaude(s) {
    const ps = panes();
    const open = claudePane(s, ps);
    if (open) {
      run("tab.select", { id: open.tab });
      run("pane.focus", { pane: open.pane });
      return;
    }
    const { [s.id]: _, ...pins } = map("sessions.claude");
    setShared("sessions.claude", pins);
    run("tab.new", { space: s.id, folder: place(s, ps), argv: [CLAUDE] });
  }

  openClaude(s, cx) {
    const ps = panes();
    const existing = claudePane(s, ps);
    if (existing) {
      run("tab.select", { id: existing.tab });
      run("pane.focus", { pane: existing.pane });
      return;
    }
    const cwd = place(s, ps);
    if (!this.git[this.where(s, ps)] && !map("sessions.claude")[s.id]) return;
    cx.spawn(async () => {
      const id = map("sessions.claude")[s.id] ?? (await latestConversation(cwd));
      const here = this.git[JSON.stringify([s.machine ?? null, cwd])];
      const note = here && !here.linked ? ["--append-system-prompt", mainCheckoutNote(base(here.root))] : [];
      const argv = id ? [CLAUDE, "--resume", id, ...note] : [CLAUDE, ...note];
      if (id) setShared("sessions.claude", { ...map("sessions.claude"), [s.id]: id });
      run("tab.new", { space: s.id, folder: cwd, argv });
    });
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

  openComposer(preferred = null, preferredSection = null) {
    const ps = panes();
    const all = spaces().map((space) => this.info(space, ps));
    const folders = [...new Set([...all.map((r) => r.folderKey), ...(shared("sessions.folders") ?? [])])].filter((key) => JSON.parse(key)[1] !== home()).sort((a, b) => byName(base(JSON.parse(a)[1]), base(JSON.parse(b)[1])));
    const active = all.find((r) => r.s.active);
    const folder = preferred && folders.includes(preferred) ? preferred : active && folders.includes(active.folderKey) ? active.folderKey : folders[0] ?? null;
    const section = preferredSection ?? (!preferred && active && active.folderKey === folder ? (map("sessions.membership")[active.s.id] ?? null) : null);
    openOverlay({ mod: "sessions", kind: "dialog", width: 720, height: 560, props: { composer: { folders, folder, section } } });
  }

  adoptCreated(sp) {
    const pending = shared("sessions.pending") ?? [];
    if (!pending.length) return;
    const taken = new Set([...Object.keys(map("sessions.membership")), ...this.known]);
    const left = pending.filter((p) => {
      if (Date.now() - p.at > 120000) return false;
      const space = sp.find((s) => s.named && s.name === p.name && !taken.has(s.id));
      if (!space) return true;
      if (p.dev) setShared("sessions.dev", space.id);
      if (p.section) moveTo(space.id, p.section);
      if (p.focus && !p.dev) star(space.id, true);
      if (p.claude) setShared("sessions.claude", { ...map("sessions.claude"), [space.id]: p.claude });
      return false;
    });
    if (left.length !== pending.length) setShared("sessions.pending", left);
  }

  prune(sp) {
    this.adoptCreated(sp);
    if (machines().some((m) => m.layout !== "ready")) return;
    const ids = new Set(sp.map((s) => s.id));
    for (const key of ["focus.starred", "focus.snoozed", "focus.untilReview", "focus.pinned", "sessions.membership", "sessions.noAutoSettle", "sessions.prOpenSeen", "pr.autoFix", "pr.autoFixStatus", "pr.mergeWhenReady", "pr.readyFor"]) {
      const value = map(key);
      const kept = Object.fromEntries(Object.entries(value).filter(([id]) => ids.has(id)));
      if (Object.keys(kept).length !== Object.keys(value).length) setShared(key, kept);
    }
    const fresh = sp.filter((s) => !this.known.has(s.id));
    for (const s of fresh) {
      this.known.add(s.id);
      if (shared("focus.on") && s.id !== shared("sessions.dev") && !(shared("sessions.pending") ?? []).some((p) => p.dev && p.name === s.name)) star(s.id, true);
    }
  }

  toggleFolder(key, cx) {
    if (this.collapsed.has(key)) this.collapsed.delete(key);
    else this.collapsed.add(key);
    localStorage.setItem("folders.collapsed", JSON.stringify([...this.collapsed]));
    cx.notify();
  }

  sections(folderKey) {
    return (shared("sessions.sections") ?? []).filter((section) => section.folder === folderKey).sort((a, b) => byName(a.name, b.name));
  }

  updateSection(id, change) {
    const all = shared("sessions.sections") ?? [];
    setShared("sessions.sections", change === null ? all.filter((s) => s.id !== id) : all.map((s) => (s.id === id ? { ...s, ...change } : s)));
    if (change === null) setShared("sessions.membership", Object.fromEntries(Object.entries(map("sessions.membership")).filter(([, section]) => section !== id)));
  }

  startEditing(editing, value, cx) {
    this.editing = editing;
    this.input = InputState.new({ value });
    if (value) this.input.set_selected_range({ start: 0, end: value.length });
    this.input.on("submit", (_e, cx) => this.finishEditing(true, cx));
    this.input.on("blur", (_e, cx) => this.finishEditing(false, cx));
    this.input.focus();
    cx.timer.after(50, () => this.input?.focus());
    cx.notify();
  }

  finishEditing(save, cx) {
    const editing = this.editing;
    if (!editing) return;
    const name = this.input?.value().trim() ?? "";
    this.editing = null;
    this.input = null;
    if (save && name) {
      if (editing.kind === "new") setShared("sessions.sections", [...(shared("sessions.sections") ?? []), { id: newId(), name, folder: editing.folder, collapsed: false }]);
      else this.updateSection(editing.id, { name });
    }
    cx.notify();
  }

  editor(t) {
    return div().id("section-editor").ml(14).px(6).py(3).on_key_down((e, cx) => {
      if (e.key === "escape") {
        this.editing = null;
        this.input = null;
        cx.stop_propagation();
        cx.notify();
      }
    }).child(Input.new(this.input).h(26).px(8).rounded(6).border_1().border_color(t.accent).bg(t.background).text_size(12).text_color(t.foreground));
  }

  entry(row) {
    return { id: row.s.id, name: row.name, folderKey: row.folderKey, cwd: place(row.s, panes()), branch: row.g?.branch ?? null, pr: row.pr, root: row.g?.root ?? null, machine: row.s.machine ?? null };
  }

  openMenu(row) {
    openOverlay({ mod: "sessions", kind: "popup", width: 240, height: 500, props: { menu: { id: row.s.id, folderKey: row.folderKey, url: row.pr?.url ?? null, entry: this.entry(row) } } });
  }

  dropOn(sectionId, folderKey, cx) {
    const from = this.pressed;
    this.pressed = null;
    this.over = null;
    if (from && from.folderKey === folderKey) moveTo(from.id, sectionId);
    cx.notify();
  }

  dot(status, t) {
    const color = status === "working" ? t.working : status === "blocked" ? t.blocked : status === "done" ? t.done : t.idle;
    return div().size(7).flex_none().rounded(4).bg(color).when(status === "working", (el) => el.loop("opacity", { from: 0.35, to: 1, period: 1200 })).when(!status || status === "idle", (el) => el.opacity(0.6));
  }

  row(row, t, indent = false) {
    const { s, pr, g } = row;
    this.visibleOrder?.push(s.id);
    const starred = Boolean(map("focus.starred")[s.id]);
    const snoozedUntil = snoozed(s.id) ? snoozeLabel(s.id) : null;
    const state = prState(pr);
    const reviewStatus = review(pr, t);
    const meta = pr
      ? h_flex().gap(5).items_center().child(div().flex_none().child(`#${pr.number}`))
          .when(Boolean(reviewStatus), (el) => el.child(div().flex_none().text_color(reviewStatus[1]).child(reviewStatus[0])))
          .when(state === "merged" || state === "closed" || state === "draft", (el) => el.child(div().flex_none().child({ merged: "Merged", closed: "Closed", draft: "Draft" }[state])))
          .child(div().flex_none().child(`· ${age(pr.createdAt)}`))
          .map((el) => {
            const markers = this.autoMarkers(s, pr, t);
            return markers ? el.child(h_flex().flex_none().gap(4).items_center().child(div().child("·")).child(markers)) : el;
          })
      : div().truncate().child(g?.branch && row.name !== g.branch && !DEFAULT_BRANCHES.has(g.branch) ? g.branch : g ? (g.linked ? base(g.top) : g.branch ?? "") : "");
    const dragging = this.pressed?.id === s.id;
    return h_flex()
      .id(`session-${s.id}`)
      .relative()
      .when(indent, (el) => el.ml(14))
      .gap(10)
      .px(8)
      .py(6)
      .flex_none()
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .when(s.active, (el) => el.bg(t.selected))
      .when(!s.active, (el) => el.hover((st) => st.bg(t.hover)))
      .when(dragging, (el) => el.opacity(0.5))
      .on_mouse_down("left", () => { this.pressed = { id: s.id, folderKey: row.folderKey }; })
      .on_mouse_up("left", (_e, cx) => {
        if (this.pressed?.id === s.id) {
          if (this.activeView() !== "work") this.showView("work");
          run("space.select", { id: s.id });
          this.openClaude(s, cx);
        }
        this.pressed = null;
        this.over = null;
        cx.notify();
      })
      .on_mouse_down("right", () => this.openMenu(row))
      .on_hover(this.hovering(`row-${s.id}`))
      .child(this.dot(s.status, t))
      .child(
        v_flex().flex_1().min_w(0)
          .child(h_flex().gap(5).items_center().min_w(0)
            .when(Boolean(state), (el) => el.child(svg(ICON(`pr-${state}`)).size(13).flex_none().text_color(state === "open" ? t.done : state === "merged" ? t.ansi5 : state === "closed" ? t.ansi1 : t.dim)))
            .child(div().min_w(0).truncate().text_size(13).text_color(state === "merged" || state === "closed" ? t.muted : t.foreground).child(row.name))
            .when(Boolean(snoozedUntil), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`💤 ${snoozedUntil}`)))
            .when(pinned(s.id) && Boolean(shared("focus.on")), (el) => el.child(svg("mods/workspace-chrome/pin.svg").size(10).flex_none().text_color(t.dim))))
          .when(Boolean(pr || g), (el) => el.child(h_flex().mt(1).min_w(0).text_size(11).text_color(t.dim).child(meta))),
      )
      .child(
        div().id(`settle-${s.id}`).flex_none().p(3).rounded(4).text_color(t.dim).map(this.reveal(`row-${s.id}`))
          .tooltip("Settle: done for now. It moves to Settled, and Restore brings Claude back on the same conversation")
          .hover((st) => st.bg(t.raised).text_color(t.done))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); cx.spawn(async () => settleSession(this.entry(row))); })
          .child(svg(ICON("check")).size(13)),
      )
      .when(s.id !== shared("sessions.dev") && !shared("focus.on"), (el) => el.child(
        div().id(`star-${s.id}`).flex_none().p(3).rounded(4).text_color(starred ? t.working : t.dim).when(!starred, this.reveal(`row-${s.id}`))
          .tooltip(starred ? "Remove from focus" : "Add to focus: focus mode shows only these sessions")
          .hover((st) => st.bg(t.raised).text_color(starred ? t.working : t.foreground))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); star(s.id, !starred); cx.notify(); })
          .child(svg(ICON(starred ? "bulb-fill" : "bulb")).size(13)),
      ))
      .when(s.id === shared("sessions.dev"), (el) => el.child(div().flex_none().px(5).py(1).rounded(4).bg(t.raised).text_size(10.5).text_color(t.dim).tooltip("Claude on your Herdr config (⌘,). Never shown in focus mode.").child("config")));
  }

  sectionHeader(section, rows, folderKey, t) {
    const needsYou = rows.filter((r) => r.s.status === "blocked" || r.s.status === "done").length;
    const target = this.pressed && this.pressed.folderKey === folderKey && this.over === section.id;
    if (this.editing?.kind === "rename" && this.editing.id === section.id) return this.editor(t);
    return h_flex()
      .id(`section-${section.id}`)
      .mt(8)
      .ml(14)
      .px(6)
      .py(3)
      .gap(5)
      .items_center()
      .rounded(6)
      .text_size(11)
      .text_color(t.muted)
      .cursor_pointer()
      .hover((st) => st.bg(t.hover))
      .when(target, (el) => el.border_1().border_color(t.accent))
      .on_mouse_move((_e, cx) => { if (this.pressed && this.over !== section.id) { this.over = section.id; cx.notify(); } })
      .on_mouse_up("left", (_e, cx) => { if (this.pressed) this.dropOn(section.id, folderKey, cx); })
      .on_click(() => this.updateSection(section.id, { collapsed: !section.collapsed }))
      .on_hover(this.hovering(`section-${section.id}`))
      .child(svg("mods/workspace-chrome/layers.svg").size(11).flex_none().text_color(t.dim).when(section.collapsed, (el) => el.opacity(0.5)))
      .child(div().flex_1().min_w(0).truncate().font_medium().child(section.name.toUpperCase()))
      .when(!shared("focus.on") || Boolean(section.collapsed && needsYou), (el) => el.child(div().flex_none().text_color(section.collapsed && needsYou ? t.done : t.dim).child(section.collapsed && needsYou ? `${needsYou} ●` : String(rows.length))))
      .child(div().id(`section-new-${section.id}`).flex_none().p(2).rounded(4).text_color(t.dim).hover((st) => st.bg(t.raised).text_color(t.foreground)).tooltip("New session in this section").map(this.reveal(`section-${section.id}`))
        .on_click((_e, cx) => { cx.stop_propagation(); this.openComposer(folderKey, section.id); })
        .child(svg(ICON("plus")).size(11)))
      .when(!shared("focus.on"), (el) => el.child(div().id(`section-rename-${section.id}`).map(this.reveal(`section-${section.id}`)).flex_none().p(2).rounded(4).hover((st) => st.bg(t.raised).text_color(t.foreground)).tooltip("Rename section")
        .on_click((_e, cx) => { cx.stop_propagation(); this.startEditing({ kind: "rename", id: section.id }, section.name, cx); })
        .child(svg("mods/workspace-chrome/square-pen.svg").size(11)))
      .child(div().id(`section-delete-${section.id}`).map(this.reveal(`section-${section.id}`)).flex_none().p(2).rounded(4).hover((st) => st.bg(t.raised).text_color(t.foreground)).tooltip("Delete section: its sessions move to the folder")
        .on_click((_e, cx) => { cx.stop_propagation(); this.updateSection(section.id, null); cx.notify(); })
        .child(svg("mods/workspace-chrome/x.svg").size(11))));
  }

  folder(folderKey, rows, t) {
    const [on, path] = JSON.parse(folderKey);
    const collapsed = this.collapsed.has(folderKey);
    const focus = Boolean(shared("focus.on"));
    const sections = this.sections(folderKey);
    const sectionIds = new Set(sections.map((s) => s.id));
    const membership = map("sessions.membership");
    const loose = rows.filter((r) => !sectionIds.has(membership[r.s.id]));
    const needsYou = rows.filter((r) => r.s.status === "blocked" || r.s.status === "done").length;
    const target = this.pressed && this.pressed.folderKey === folderKey && this.over === folderKey;
    const head = h_flex()
      .id(`folder-${folderKey}`)
      .mt(10)
      .px(6)
      .py(4)
      .gap(6)
      .items_center()
      .rounded(6)
      .text_size(13)
      .font_semibold()
      .text_color(t.foreground)
      .cursor_pointer()
      .hover((st) => st.bg(t.hover))
      .when(target, (el) => el.border_1().border_color(t.accent))
      .on_mouse_move((_e, cx) => { if (this.pressed && this.over !== folderKey) { this.over = folderKey; cx.notify(); } })
      .on_mouse_up("left", (_e, cx) => { if (this.pressed) this.dropOn(null, folderKey, cx); })
      .on_click((_e, cx) => this.toggleFolder(folderKey, cx))
      .on_hover(this.hovering(`folder-${folderKey}`))
      .when(path !== home(), (el) => el.on_mouse_down("right", () => openOverlay({ mod: "sessions", kind: "popup", width: 300, height: 190, props: { menu: { folderMenu: folderKey } } })))
      .child(svg(ICON(collapsed ? "chevron-right" : "chevron-down")).size(12).flex_none().text_color(t.dim))
      .child(div().flex_1().min_w(0).truncate().child(path === home() ? "~" : base(path)).when(Boolean(on), (el) => el.child(div().text_color(t.dim).font_normal().child(` · ${on}`))))
      .when(Boolean(this.mains?.[folderKey]?.branch && this.mains[folderKey].def && this.mains[folderKey].branch !== this.mains[folderKey].def), (el) => {
        const main = this.mains[folderKey];
        return el.child(h_flex().id(`folder-branch-${folderKey}`).flex_none().max_w(150).gap(4).px(6).py(1).rounded(5).bg(t.raised).text_size(11).font_normal().text_color(t.blocked)
          .tooltip(main.dirty ? `The main checkout is on ${main.branch}, with uncommitted changes. Commit or stash them, then switch to ${main.def}.` : `The main checkout is on ${main.branch}. Click to switch it to ${main.def} and update it.`)
          .when(!main.dirty, (el) => el.cursor_pointer().hover((st) => st.text_color(t.foreground)).on_click((_e, cx) => { cx.stop_propagation(); this.switchToDefault(folderKey, cx); }))
          .child(div().min_w(0).truncate().child(`on ${main.branch}`))
          .when(!main.dirty, (el) => el.child(div().flex_none().text_color(t.accent).child(`→ ${main.def}`))));
      })
      .when(collapsed && needsYou > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.done).child(`${needsYou} ●`)))
      .when(!focus, (el) => el.child(div().id(`folder-section-${folderKey}`).map(this.reveal(`folder-${folderKey}`)).flex_none().p(3).rounded(4).text_color(t.dim).hover((st) => st.bg(t.raised).text_color(t.foreground)).tooltip("New section")
        .on_click((_e, cx) => { cx.stop_propagation(); if (collapsed) this.toggleFolder(folderKey, cx); this.startEditing({ kind: "new", folder: folderKey }, "", cx); })
        .child(svg("mods/workspace-chrome/layers.svg").size(12))))
      .child(div().id(`folder-new-${folderKey}`).flex_none().p(3).rounded(4).text_color(t.dim).map(this.reveal(`folder-${folderKey}`)).hover((st) => st.bg(t.raised).text_color(t.foreground)).tooltip(path === home() ? "New space here" : "New session in this folder (⌥⌘N)")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          if (path === home()) run("space.new", { folder: path, machine: on ?? "", argv: [CLAUDE] });
          else this.openComposer(folderKey);
        })
        .child(svg(ICON("plus")).size(12)));
    const removable = rows.length === 0;
    const withRemove = removable
      ? head.child(div().id(`folder-remove-${folderKey}`).map(this.reveal(`folder-${folderKey}`)).flex_none().p(3).rounded(4).text_color(t.dim).hover((st) => st.bg(t.raised).text_color(t.foreground)).tooltip("Remove this folder from the list")
          .on_click((_e, cx) => { cx.stop_propagation(); setShared("sessions.folders", (shared("sessions.folders") ?? []).filter((key) => key !== folderKey)); cx.notify(); })
          .child(svg("mods/workspace-chrome/x.svg").size(12)))
      : head;
    if (collapsed || removable) return [withRemove];
    const shownSections = sections.filter((section) => !focus || rows.some((r) => membership[r.s.id] === section.id));
    return [
      withRemove,
      ...loose.map((r) => this.row(r, t)),
      ...shownSections.flatMap((section) => {
        const inside = rows.filter((r) => membership[r.s.id] === section.id);
        return [this.sectionHeader(section, inside, folderKey, t), ...(section.collapsed ? [] : inside.length ? inside.map((r) => this.row(r, t, true)) : [div().pl(40).py(3).text_size(11).text_color(t.dim).child("Drag sessions here")])];
      }),
      ...(this.editing?.kind === "new" && this.editing.folder === folderKey ? [this.editor(t)] : []),
    ];
  }

  render(cx) {
    if (props()?.pr) return this.panel.render();
    if (props()?.bar) return renderBar(this, isChatSpace(spaces().find((s) => s.active) ?? {}));
    if (props()?.header) return this.renderHeader();
    if (props()?.composer) return this.renderComposer();
    if (props()?.welcome) return this.renderWelcome();
    if (props()?.menu) return this.renderMenu();
    const t = theme();
    const sp = spaces().filter((s) => !isChatSpace(s));
    const ps = panes();
    this.prune(sp);
    const focus = Boolean(shared("focus.on"));
    const now = Date.now();
    const all = sp.map((s) => this.info(s, ps));
    const shown = all.filter((r) => !hidden(r.s.id, now));
    const snoozedCount = all.filter((r) => map("focus.starred")[r.s.id] && snoozed(r.s.id, now)).length;
    const workingRows = focus && conf().focusWorking ? shown.filter((r) => r.s.status === "working" && !pinned(r.s.id)) : [];
    const listed = focus ? shown.filter((r) => !workingRows.includes(r)) : all;
    const folders = [...new Set([...listed.map((r) => r.folderKey), ...(focus ? [] : (shared("sessions.folders") ?? []))])].sort((a, b) => byName(base(JSON.parse(a)[1]), base(JSON.parse(b)[1])));
    const banner = focus
      ? h_flex().mx(8).mb(2).px(10).py(6).flex_none().items_center().rounded(8).bg(t.raised).text_size(12).text_color(t.muted)
          .child(svg(ICON("focus")).size(12).mr(6).text_color(t.accent))
          .child(div().flex_1().child("Focus mode"))
          .child(div().id("focus-off").text_color(t.accent).cursor_pointer().hover((st) => st.text_color(t.foreground)).on_click((_e, cx) => cx.spawn(async (cx) => { await setFocus(false); cx.notify(); })).child("Show all"))
      : null;
    const empty = focus && listed.length === 0
      ? v_flex().px(16).py(14).gap(6).text_size(12.5).text_color(t.muted)
          .child(div().child(workingRows.length ? `Claude is working in all ${workingRows.length === 1 ? "of your focus session" : `${workingRows.length} focus sessions`}. They come back here when Claude finishes.` : snoozedCount ? `All ${snoozedCount} focus ${snoozedCount === 1 ? "session is" : "sessions are"} snoozed.` : "Nothing to focus on."))
          .child(div().text_size(11.5).text_color(t.dim).child("Add sessions with the 💡 on their row. Snoozed sessions come back on their own."))
      : null;
    const rows = listed;
    this.visibleOrder = [];
    return v_flex().size_full().min_h(0).bg(t.chrome)
      .on_mouse_up("left", (_e, cx) => { this.pressed = null; this.over = null; cx.notify(); })
      .when(Boolean(banner), (el) => el.child(banner))
      .when(Boolean(empty), (el) => el.child(empty))
      .child(v_flex().flex_1().min_h(0).px(8).pb(14).overflow_y_scrollbar()
        .children(folders.flatMap((key) => this.folder(key, rows.filter((r) => r.folderKey === key), t)))
        .when(focus, (el) => el.children(this.workingList(workingRows, t)))
        .when(focus, (el) => el.children(this.snoozedList(all, t)))
        .children(this.archiveList(t)));
  }


  renderHeader() {
    const t = theme();
    const focus = Boolean(shared("focus.on"));
    return h_flex().h(34).pl(14).pr(8).flex_none().items_center().gap(4).text_size(12).text_color(t.dim)
      .child(div().flex_1())
      .child(div().id("chats-toggle").p(5).rounded(6).text_color(this.chatsMode ? t.accent : t.dim).when(this.chatsMode, (el) => el.bg(t.raised))
        .hover((st) => st.bg(t.hover).text_color(this.chatsMode ? t.accent : t.foreground))
        .tooltip(this.chatsMode ? "Back to the sessions (⇧⌘C)" : "Chats with Claude (⇧⌘C)")
        .on_click((_e, cx) => { this.toggleChats(); cx.notify(); })
        .child(svg(ICON("chat")).size(14)))
      .child(div().id("focus-toggle").p(5).rounded(6).text_color(focus ? t.accent : t.dim).when(focus, (el) => el.bg(t.raised))
        .hover((st) => st.bg(t.hover).text_color(focus ? t.accent : t.foreground))
        .tooltip(focus ? "Stop focus mode (⌘⇧F)" : "Focus mode (⌘⇧F): only the sessions you added, sounds off")
        .on_click((_e, cx) => cx.spawn(async (cx) => { await this.focusPressed(); cx.notify(); }))
        .child(svg(ICON("focus")).size(14)))
      .children(extensions().filter((ext) => ext.icon && ext.view && inLayout(ext.view)).map((ext) => {
        const open = this.activeView() === ext.view;
        const count = Number(shared(ext.badge ?? "") ?? 0) || 0;
        const key = ext.key ? ` (${ext.key})` : "";
        return div().id(`ext-${ext.id}`).relative().p(5).rounded(6).text_color(open ? t.accent : t.dim).when(open, (el) => el.bg(t.raised))
          .hover((st) => st.bg(t.hover).text_color(open ? t.accent : t.foreground))
          .tooltip(open ? `Back to the sessions${key}` : count ? `${ext.title}${key}: ${count} new` : `${ext.title}${key}`)
          .on_click((_e, cx) => { this.toggleExtension(ext.id); cx.notify(); })
          .child(svg(ext.icon).size(14))
          .when(count > 0, (el) => el.child(div().absolute().top(1).right(1).size(7).rounded(4).bg(t.accent)));
      }))
      .child(div().id("folder-add").p(5).rounded(6).hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip("Add a folder")
        .on_click((_e, cx) => cx.spawn(async (cx) => {
          const path = await pickFolder({ prompt: "Add folder" });
          if (!path) return;
          const top = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: path }).catch(() => null);
          const dir = top?.code === 0 ? top.stdout.trim() : "";
          this.addFolders([JSON.stringify([null, dir.endsWith("/.git") ? dir.slice(0, -5) : path])]);
          cx.notify();
        }))
        .child(svg(ICON("folder-plus")).size(14)))
      .child(div().id("session-new").p(5).rounded(6).hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip("New session (⌥⌘N)")
        .on_click(() => run("sessions.new-session"))
        .child(svg(ICON("plus")).size(14)));;
  }

  workingList(rows, t) {
    if (!rows.length) return [];
    const open = localStorage.getItem("working.open") === "1";
    const head = h_flex().id("working-head").mt(16).px(6).py(4).gap(6).items_center().rounded(6).text_size(12).text_color(t.dim).cursor_pointer().hover((st) => st.bg(t.hover))
      .on_click((_e, cx) => { localStorage.setItem("working.open", open ? "0" : "1"); cx.notify(); })
      .child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(12).flex_none())
      .child(div().size(7).flex_none().rounded(4).bg(t.working).loop("opacity", { from: 0.35, to: 1, period: 1200 }))
      .child(div().flex_1().font_medium().child(`Working · ${rows.length}`));
    if (!open) return [head];
    return [head, ...rows.map((r) => h_flex().id(`working-${r.s.id}`).on_mouse_down("right", () => this.openMenu(r)).px(8).py(5).gap(8).items_center().rounded(6).cursor_pointer().hover((st) => st.bg(t.hover))
      .on_click((_e, cx) => { run("space.select", { id: r.s.id }); this.openClaude(r.s, cx); })
      .child(div().size(7).flex_none().rounded(4).bg(t.working).loop("opacity", { from: 0.35, to: 1, period: 1200 }))
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().text_size(12.5).text_color(t.muted).child(r.name))
        .child(div().truncate().text_size(11).text_color(t.dim).child(`${r.pr ? `#${r.pr.number} · ` : ""}${base(JSON.parse(r.folderKey)[1])}${workingFor(r.s) ? ` · working ${workingFor(r.s)}` : ""}`)))
      .child(div().id(`working-pin-${r.s.id}`).flex_none().p(3).rounded(4).text_color(t.dim).tooltip("Pin: keep it in the list while Claude works")
        .hover((st) => st.bg(t.raised).text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); setPinned(r.s.id, true); cx.notify(); })
        .child(svg("mods/workspace-chrome/pin.svg").size(12))))];
  }

  autoMarkers(s, pr, t) {
    const fix = this.autoFixMarker(s, t);
    const waiting = mergeWaiting(s.id);
    const merge = pr?.state === "OPEN" && (Boolean(pr.autoMergeRequest) || Boolean(waiting));
    if (!fix && !merge) return null;
    const mergeLook = waiting?.state === "queued" ? [t.done, "In the merge queue"] : waiting?.state === "dropped" ? [t.blocked, "It left the merge queue. Turn Merge when ready off and on to queue it again"] : [t.dim, waiting && autoFixBusy(s.id) ? "Merge when ready: waiting for auto-fix to finish" : waiting ? "Merge when ready: Herdr adds it to the merge queue once it is approved, green and auto-fix is done" : "Auto-merge is on: GitHub merges this PR when it is ready"];
    return h_flex().flex_none().gap(4).items_center()
      .when(Boolean(fix), (el) => el.child(div().id(`autofix-${s.id}`).flex_none().text_color(fix.color).tooltip(fix.tip).child(svg(ICON("wrench")).size(11))))
      .when(merge, (el) => el.child(div().id(`automerge-${s.id}`).flex_none().text_color(mergeLook[0]).tooltip(mergeLook[1]).child(svg(ICON("git-merge-queue")).size(11))));
  }

  snoozedList(rows, t) {
    const now = Date.now();
    const sleeping = rows.filter((r) => map("focus.starred")[r.s.id] && snoozed(r.s.id, now)).sort((a, b) => (map("focus.snoozed")[a.s.id] ?? Infinity) - (map("focus.snoozed")[b.s.id] ?? Infinity));
    if (!sleeping.length) return [];
    const open = localStorage.getItem("snoozed.open") === "1";
    const head = h_flex().id("snoozed-head").mt(16).px(6).py(4).gap(6).items_center().rounded(6).text_size(12).text_color(t.dim).cursor_pointer().hover((st) => st.bg(t.hover))
      .on_click((_e, cx) => { localStorage.setItem("snoozed.open", open ? "0" : "1"); cx.notify(); })
      .child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(12).flex_none())
      .child(svg(ICON("clock")).size(12).flex_none())
      .child(div().flex_1().font_medium().child(`Snoozed · ${sleeping.length}`));
    if (!open) return [head];
    return [head, ...sleeping.map((r) => h_flex().id(`snoozed-${r.s.id}`).on_mouse_down("right", () => this.openMenu(r)).px(8).py(5).gap(8).items_center().rounded(6).cursor_pointer().hover((st) => st.bg(t.hover))
      .on_click((_e, cx) => { run("space.select", { id: r.s.id }); this.openClaude(r.s, cx); })
      .child(svg(ICON("clock")).size(12).flex_none().text_color(t.dim))
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().text_size(12.5).text_color(t.muted).child(r.name))
        .child(div().truncate().text_size(11).text_color(t.dim).child(`${r.pr ? `#${r.pr.number} · ` : ""}${base(JSON.parse(r.folderKey)[1])} · until ${snoozeLabel(r.s.id)}`)))
      .map((el) => { const markers = this.autoMarkers(r.s, r.pr, t); return markers ? el.child(markers) : el; })
      .child(div().id(`snoozed-change-${r.s.id}`).flex_none().p(3).rounded(4).text_color(t.dim).tooltip("Change the time or unsnooze")
        .hover((st) => st.bg(t.raised).text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "sessions", kind: "popup", width: 260, height: 250, props: { menu: { id: r.s.id, snoozeOnly: true } } }); })
        .child(svg(ICON("clock")).size(12))))];
  }

  archiveList(t) {
    const entries = archived();
    if (!entries.length) return [];
    const open = localStorage.getItem("archive.open") === "1";
    const when = (at) => {
      const d = new Date(at);
      const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
    };
    const head = h_flex().id("archive-head").mt(16).px(6).py(4).gap(6).items_center().rounded(6).text_size(12).text_color(t.dim).cursor_pointer().hover((st) => st.bg(t.hover))
      .on_click((_e, cx) => { localStorage.setItem("archive.open", open ? "0" : "1"); cx.notify(); })
      .child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(12).flex_none())
      .child(svg(ICON("check")).size(12).flex_none())
      .child(div().flex_1().font_medium().child(`Settled · ${entries.length}`));
    if (!open) return [head];
    return [head, ...entries.map((entry) => h_flex().id(`archived-${entry.key}`).px(8).py(5).gap(8).items_center().rounded(6).hover((st) => st.bg(t.hover))
      .child(svg(ICON("archive")).size(12).flex_none().text_color(t.dim))
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().text_size(12.5).text_color(t.muted).child(entry.name))
        .child(div().truncate().text_size(11).text_color(entry.kept ? t.blocked : t.dim).child(entry.kept ? `Worktree kept: ${entry.kept}` : `${entry.pr ? `#${entry.pr.number} · ` : ""}${base(JSON.parse(entry.folderKey)[1])} · settled ${when(entry.settledAt)}`)))
      .child(div().id(`restore-${entry.key}`).flex_none().p(3).rounded(4).text_color(t.dim).tooltip("Restore: reopen it with Claude on the same conversation")
        .hover((st) => st.bg(t.raised).text_color(t.foreground))
        .on_click((_e, cx) => cx.spawn(async () => {
          const exists = await exec("test", ["-d", entry.cwd]).then((r) => r.code === 0).catch(() => false);
          if (!exists) return notify({ title: "Could not restore", body: `${entry.cwd} no longer exists.`, level: "error" });
          restoreSession(entry);
        }))
        .child(svg(ICON("restore")).size(12)))
      .child(div().id(`forget-${entry.key}`).flex_none().p(3).rounded(4).text_color(t.dim).tooltip("Remove now: deletes its worktree and Claude conversation")
        .hover((st) => st.bg(t.raised).text_color(t.foreground))
        .on_click((_e, cx) => cx.spawn(async (cx) => {
          const kept = await forgetSettled(entry).catch((e) => e.message);
          if (kept) notify({ title: `Kept the worktree of “${entry.name}”`, body: `It has ${kept}. Push or discard them, then remove it again.`, level: "warning" });
          cx.notify();
        }))
        .child(svg("mods/workspace-chrome/x.svg").size(11))))];
  }

  initMenu(_cx) {
    this.menuItems = [];
  }

  initFolderMenu(cx) {
    const folder = JSON.parse(props().menu.folderMenu)[1];
    this.setupInput = InputState.new({ value: conf().setup?.[folder] ?? "", placeholder: "e.g. bin/setup" });
    this.setupInput.on("change", () => setConf({ setup: { ...(conf().setup ?? {}), [folder]: this.setupInput.value() } }));
    this.setupInput.on("submit", () => closeOverlay(props().overlay));
    cx.timer.after(40, () => this.setupInput.focus?.());
  }

  initSnooze(cx) {
    this.customOpen = false;
    this.snoozeInput = InputState.new({ value: "", placeholder: "e.g. 2h or fri 10:00" });
    this.snoozeInput.on("change", (_e, cx) => cx.notify());
    this.snoozeInput.on("submit", () => {
      const until = parseSnooze(this.snoozeInput.value());
      if (!until) return;
      closeOverlay(props().overlay);
      if (props().menu.store) snoozeStore(props().menu, until);
      else snooze(props().menu.id, until);
    });
  }

  initComposer(cx) {
    const p = props().composer;
    this.composer = { folder: p.folder, section: p.section, where: "worktree", whereTouched: false, folderTouched: false, autoFor: null, model: localStorage.getItem("composer.model") || null, mode: localStorage.getItem("composer.mode") || "auto", focus: Boolean(shared("focus.on")) || localStorage.getItem("composer.focus") === "1", starting: null, error: null };
    this.message = TextareaState.new({ placeholder: "What fire are we putting out first?", rows: 7 });
    this.message.on("change", (_e, cx) => cx.notify());
    this.message.on("submit", (_e, cx) => this.startSession(cx));
    if (!composerKeysBound) {
      composerKeysBound = true;
      cx.bind_keys([
        { keystroke: "cmd-enter", action: "composer_start", context: "SessionComposer" },
        { keystroke: "alt-cmd-enter", action: "composer_background", context: "SessionComposer" },
      ]);
    }
    this.message.focus?.();
    this.handle = cx.focus_handle();
    cx.timer.after(80, () => this.message.focus?.());
  }

  startSession(cx, background = false) {
    const c = this.composer;
    const text = this.message.value().trim();
    if (!text || !c.folder || (!background && c.starting)) return;
    const link = text.match(PR_LINK);
    const where = c.where === "pr" && !link ? "worktree" : c.where;
    const choice = { folder: c.folder, section: c.section, where, worktree: where !== "main", pr: where === "pr" ? link[0] : null, model: c.model, mode: c.mode, focus: c.focus };
    localStorage.setItem("composer.focus", c.focus ? "1" : "0");
    const [machine, folder] = JSON.parse(choice.folder);
    let name = sessionName(text);
    const previous = spaces().find((space) => space.active)?.id ?? null;
    localStorage.setItem("composer.model", choice.model ?? "");
    localStorage.setItem("composer.mode", choice.mode);
    c.error = null;
    if (background) {
      this.message.set_value("");
      c.launched = [...(c.launched ?? []), { name, state: choice.pr ? "checking out the PR" : choice.worktree ? "naming the branch" : "starting" }];
      c.where = "worktree";
      c.whereTouched = false;
      c.autoFor = null;
    } else c.starting = choice.pr ? "Checking out the PR…" : choice.worktree ? "Naming the branch…" : "Starting…";
    const launch = c.launched?.[c.launched.length - 1];
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const id = newId();
        const dir = `${appHome()}/data/new-session`;
        await exec("mkdir", ["-p", dir]);
        const scriptPath = `${dir}/start.sh`;
        const current = await readTextFile(scriptPath).catch(() => null);
        if (current !== START_SCRIPT) await writeTextFile(scriptPath, START_SCRIPT, current);
        const messagePath = `${dir}/${id}.txt`;
        await writeTextFile(messagePath, choice.pr && text.replace(choice.pr, "").trim() === "" ? "" : text, null);
        if (choice.pr) {
          const title = await exec("gh", ["pr", "view", choice.pr, "--json", "title", "--jq", ".title"], { cwd: folder }).catch(() => null);
          if (title?.code === 0 && title.stdout.trim()) name = sessionName(title.stdout.trim());
          if (launch) launch.name = name;
        }
        const prefix = conf().branchPrefix;
        const branch = choice.pr ? choice.pr : choice.worktree ? `${prefix}${await branchSlug(text, folder)}-${Math.random().toString(16).slice(2, 6)}` : "";
        const setup = choice.worktree ? setupFor(folder) : "";
        const flags = [...(choice.model ? ["--model", choice.model] : []), "--permission-mode", choice.mode, ...(choice.where === "main" ? ["--append-system-prompt", mainCheckoutNote(base(folder))] : [])];
        setShared("sessions.pending", [...(shared("sessions.pending") ?? []), { name, section: choice.section, focus: choice.focus || Boolean(shared("focus.on")), at: Date.now() }]);
        run("space.new", { name, folder, machine: machine ?? "", argv: ["sh", scriptPath, folder, branch, messagePath, choice.pr ? "2" : choice.worktree ? "1" : "0", setup, ...flags] });
        if (background) {
          if (previous) run("space.select", { id: previous });
          if (launch) launch.state = choice.pr ? `#${choice.pr.split("/").pop()}` : branch ? branch : "started";
          cx.notify();
        } else closeOverlay(props().overlay);
      } catch (e) {
        if (background && launch) launch.state = `failed: ${e.message}`;
        else {
          c.starting = null;
          c.error = e.message;
        }
        cx.notify();
      }
    });
  }

  renderComposer() {
    const t = theme();
    const p = props().composer;
    const c = this.composer;
    const sections = (shared("sessions.sections") ?? []).filter((section) => section.folder === c.folder).sort((a, b) => byName(a.name, b.name));
    const choice = (id, label, on, onClick) => div().id(id).px(10).py(5).rounded(7).text_size(12.5).cursor_pointer()
      .when(on, (el) => el.bg(t.selected).text_color(t.foreground)).when(!on, (el) => el.text_color(t.muted).hover((st) => st.bg(t.hover).text_color(t.foreground)))
      .on_click((_e, cx) => { onClick(); cx.notify(); }).child(label);
    const row = (label, children) => h_flex().gap(10).items_start()
      .child(div().w(70).flex_none().pt(5).text_size(11.5).text_color(t.dim).child(label))
      .child(h_flex().flex_1().min_w(0).gap(4).flex_wrap().children(children));
    const ready = Boolean(this.message.value().trim()) && Boolean(c.folder) && !c.starting;
    const link = this.message.value().match(PR_LINK);
    if (link && c.autoFor !== link[0]) {
      c.autoFor = link[0];
      if (!c.whereTouched) c.where = "pr";
      const repoFolder = p.folders.find((key) => base(JSON.parse(key)[1]).toLowerCase() === link[2].toLowerCase());
      if (repoFolder && !c.folderTouched && c.folder !== repoFolder) {
        c.folder = repoFolder;
        c.section = null;
      }
    }
    if (!link && c.where === "pr") c.where = "worktree";
    return v_flex().id("composer").size_full().min_h(0).p(22).gap(14).bg(t.popover).text_color(t.foreground)
      .key_context("SessionComposer")
      .on_action("composer_start", (_e, cx) => this.startSession(cx))
      .on_action("composer_background", (_e, cx) => this.startSession(cx, true))
      .on_key_down((e, cx) => {
        if (e.keystroke === "cmd-enter") { this.startSession(cx); cx.stop_propagation(); }
        else if (["alt-cmd-enter", "cmd-alt-enter"].includes(e.keystroke)) { this.startSession(cx, true); cx.stop_propagation(); }
        else if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); }
      })
      .child(h_flex().items_center().gap(10).child(svg(ICON("focus")).size(22).flex_none().text_color(t.accent)).child(div().flex_1().text_size(20).font_semibold().child("Ready when you are!")).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().flex_1().min_h(110).rounded(10).border_1().border_color(t.accent).bg(t.background).p(10).child(Textarea.new(this.message).size_full().text_size(13.5).text_color(t.foreground)))
      .child(row("Folder", p.folders.map((key) => choice(`folder-${key}`, base(JSON.parse(key)[1]), key === c.folder, () => { c.folder = key; c.section = null; c.folderTouched = true; }))))
      .when(sections.length > 0, (el) => el.child(row("Section", [choice("section-none", "None", !c.section, () => { c.section = null; }), ...sections.map((section) => choice(`section-${section.id}`, section.name, c.section === section.id, () => { c.section = section.id; }))])))
      .child(row("Where", [
        ...(link ? [choice("where-pr", `On PR #${link[3]}'s branch`, c.where === "pr", () => { c.where = "pr"; c.whereTouched = true; })] : []),
        choice("where-worktree", "New worktree", c.where === "worktree", () => { c.where = "worktree"; c.whereTouched = true; }),
        choice("where-main", "Main checkout", c.where === "main", () => { c.where = "main"; c.whereTouched = true; }),
        div().w(10),
        h_flex().id("composer-focus").px(10).py(5).gap(6).items_center().rounded(7).text_size(12.5).cursor_pointer()
          .when(c.focus, (el) => el.bg(t.selected).text_color(t.foreground)).when(!c.focus, (el) => el.text_color(t.muted).hover((st) => st.bg(t.hover).text_color(t.foreground)))
          .on_click((_e, cx) => { c.focus = !c.focus; cx.notify(); })
          .child(svg(ICON(c.focus ? "bulb-fill" : "bulb")).size(13).text_color(c.focus ? t.working : t.dim))
          .child("Add to focus")]))
      .child(row("Claude", [...MODELS.map(([value, label]) => choice(`model-${value ?? "default"}`, label, c.model === value, () => { c.model = value; })), div().w(10), ...MODES.map(([value, label]) => choice(`mode-${value}`, label, c.mode === value, () => { c.mode = value; }))]))
      .when(Boolean(c.launched?.length), (el) => el.child(v_flex().gap(2).flex_none()
        .child(div().text_size(11.5).text_color(t.dim).child(`Started ${c.launched.length} in the background`))
        .children(c.launched.slice(-4).map((l, i) => h_flex().gap(6).text_size(11.5).text_color(t.muted)
          .child(svg(ICON("check")).size(11).flex_none().text_color(l.state.startsWith("failed") ? t.blocked : l.state.startsWith("naming") ? t.dim : t.done))
          .child(div().flex_1().min_w(0).truncate().child(l.name))
          .child(div().flex_none().text_color(t.dim).child(l.state))))))
      .child(h_flex().flex_none().pt(4).items_center().gap(8)
        .child(div().flex_1().min_w(0).text_size(11.5).text_color(c.error ? t.blocked : t.dim).child(c.error ?? (c.where === "pr" ? `A worktree on PR #${link?.[3]}'s branch${link && this.message.value().replace(link[0], "").trim() ? ", then Claude starts with your message." : ". Claude opens without a message."}` : c.where === "worktree" ? "A new branch and worktree, then Claude starts with your message." : "Claude starts in the main checkout with your message.")))
        .child(h_flex().id("composer-background").h(32).px(12).gap(6).flex_none().items_center().rounded(8).text_size(12.5).border_1().border_color(t.input)
          .tooltip("Start it in the background and keep writing the next one")
          .when(Boolean(this.message.value().trim()) && Boolean(c.folder), (el) => el.text_color(t.foreground).cursor_pointer().hover((st) => st.bg(t.hover)).on_click((_e, cx) => this.startSession(cx, true)))
          .when(!(this.message.value().trim() && c.folder), (el) => el.text_color(t.dim))
          .child("Start in background  ⌥⌘↵"))
        .child(h_flex().id("composer-start").h(32).px(14).gap(6).flex_none().items_center().rounded(8).text_size(13)
          .when(ready, (el) => el.bg(t.solid).text_color(t.solid_foreground).cursor_pointer().hover((st) => st.opacity(0.88)).on_click((_e, cx) => this.startSession(cx)))
          .when(!ready, (el) => el.bg(t.raised).text_color(t.dim))
          .child(c.starting ?? "Start  ⌘↵")));
  }

  initWelcome(cx) {
    this.prefix = InputState.new({ value: conf().branchPrefix ?? "", placeholder: "e.g. fr/" });
    this.prefix.on("change", () => setConf({ branchPrefix: this.prefix.value().trim() }));
    this.checks = {};
    this.checkWelcome(cx);
  }

  checkWelcome(cx) {
    for (const [name, script] of WELCOME_TOOLS) {
      cx.spawn(async (cx) => {
        const r = await shellRun(`${script} >/dev/null 2>&1`, []).catch(() => null);
        this.checks[name] = r?.code === 0;
        cx.notify();
      });
    }
    cx.spawn(async (cx) => {
      const results = await Promise.all(WELCOME_SKILLS.map((name) => exec("test", ["-e", `${home()}/.claude/skills/herdr-app/skills/${name}/SKILL.md`]).then((r) => r.code === 0).catch(() => false)));
      this.checks.skills = results.every(Boolean);
      cx.notify();
    });
  }

  renderWelcome() {
    const t = theme();
    const c = conf();
    const close = () => closeOverlay(props().overlay);
    const heading = (text) => div().text_size(11).font_semibold().text_color(t.muted).child(text.toUpperCase());
    const card = (...rows) => v_flex().gap(12).p(14).rounded(10).border_1().border_color(t.border).bg(t.background).children(rows);
    const mark = (ok) => div().flex_none().w(16).text_size(12.5).text_color(ok == null ? t.dim : ok ? t.done : t.blocked).child(ok == null ? "…" : ok ? "✓" : "✗");
    const action = (id, label, onClick) => div().id(id).flex_none().px(10).py(4).rounded(6).text_size(12).bg(t.raised).border_1().border_color(t.border).cursor_pointer()
      .hover((st) => st.bg(t.hover)).on_click((_e, cx) => { onClick(cx); cx.notify(); }).child(label);
    const check = (ok, title, hint, extra) => h_flex().gap(10).items_start()
      .child(mark(ok))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_size(12.5).font_medium().child(title))
        .child(div().text_size(11.5).text_color(t.dim).child(hint)))
      .when(Boolean(extra), (el) => el.child(extra));
    const chip = (text) => div().flex_none().px(7).py(2).rounded(5).bg(t.raised).border_1().border_color(t.border).text_size(11.5).child(text);
    const shortcut = (action, label, fallback) => h_flex().h(26).gap(10).items_center().text_size(12.5)
      .child(div().flex_1().min_w(0).truncate().child(label))
      .child(chip(keyLabel(action) ?? fallback ?? "no key"));
    return v_flex().id("sessions-welcome").size_full().min_h(0).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key === "escape") { close(); cx.stop_propagation(); } })
      .child(v_flex().flex_none().px(22).pt(22).pb(12).gap(6)
        .child(div().text_size(16).font_semibold().child("Welcome 👋"))
        .child(div().text_size(12.5).text_color(t.muted).child("The left sidebar groups your Claude sessions by repo. Focus mode shows only the sessions you pick for today. The PR panel shows CI and reviews, and can fix, mark ready and merge for you.")))
      .child(v_flex().id("welcome-body").flex_1().min_h(0).px(22).pb(16).gap(18).overflow_y_scrollbar()
        .child(v_flex().gap(10).child(heading("Set up"))
          .child(card(
            v_flex().gap(6)
              .child(check(true, "Branch prefix", "Optional. New branches start with it, e.g. fr/fix-login-1a2b."))
              .child(div().pl(26).child(Input.new(this.prefix).h(28).px(8).rounded(6).border_1().border_color(t.input).bg(t.background).text_size(12.5))),
            ...WELCOME_TOOLS.map(([name, , what, install]) => check(this.checks[name], name, this.checks[name] === false ? `${what} Install: ${install}` : what)),
            check(this.checks.skills, "Claude skills", this.checks.skills === false ? "Auto-fix and /herdr-app:spin-off need the herdr-app plugin in ~/.claude/skills/herdr-app. Run the dotfiles install.sh." : "The herdr-app plugin: herdr-app:pr-autofix for auto-fix, and /herdr-app:spin-off."),
          )))
        .child(v_flex().gap(10).child(heading("Shortcuts"))
          .child(card(
            shortcut("sessions.new-session", "New session"),
            shortcut("sessions.focus", "Focus mode"),
            shortcut("sessions.pull-request", "Pull request panel"),
            shortcut("app.palette", "Command palette"),
            shortcut("sessions.settings", "Settings"),
            shortcut("sessions.dev", "Ask Claude to change this setup"),
            shortcut("sessions.shortcuts", "All shortcuts"),
          ))
          .child(div().text_size(11.5).text_color(t.dim).child("Right-click a session for focus, snooze and the automatic actions. Right-click a folder to set its setup command."))))
      .child(h_flex().flex_none().px(22).py(14).gap(8).border_t_1().border_color(t.border).items_center()
        .child(div().flex_1())
        .child(action("welcome-recheck", "Check again", (cx) => this.checkWelcome(cx)))
        .child(div().id("welcome-done").px(14).py(5).rounded(7).text_size(12.5).bg(t.solid).text_color(t.solid_foreground).cursor_pointer().hover((st) => st.opacity(0.88)).on_click(close).child("Done")));
  }

  renderMenu() {
    const t = theme();
    const p = props();
    const { id, folderKey, url } = p.menu;
    const starred = Boolean(map("focus.starred")[id]);
    const isSnoozed = snoozed(id);
    const membership = map("sessions.membership");
    const sections = (shared("sessions.sections") ?? []).filter((s) => s.folder === folderKey).sort((a, b) => byName(a.name, b.name));
    const close = () => closeOverlay(p.overlay);
    const item = (key, label, action, icon) => h_flex().id(`menu-${key}`).h(28).px(10).gap(8).items_center().rounded(6).text_size(12.5).text_color(t.foreground)
      .cursor_pointer().hover((st) => st.bg(t.hover))
      .on_click(() => { close(); action(); })
      .child(icon ? svg(icon).size(13).flex_none().text_color(t.muted) : div().w(13).flex_none())
      .child(div().flex_1().truncate().child(label));
    const label = (text) => div().px(10).pt(6).pb(2).text_size(11).text_color(t.dim).child(text);
    const line = () => div().my(4).h(1).bg(t.border);
    if (p.menu.folderMenu) {
      const folder = JSON.parse(p.menu.folderMenu)[1];
      return v_flex().id("sessions-folder-menu").w_full().p(5).bg(t.popover)
        .on_key_down((e, cx) => { if (e.key === "escape") { close(); cx.stop_propagation(); } })
        .child(label(`Setup command for new ${base(folder)} worktrees`))
        .child(v_flex().px(6).pt(2).pb(4).gap(5)
          .child(Input.new(this.setupInput).h(28).px(8).rounded(6).border_1().border_color(t.input).bg(t.background).text_size(12.5).text_color(t.foreground))
          .child(div().px(2).text_size(11.5).text_color(t.dim).child("Runs in the background in each new worktree. Empty means none.")));
    }
    if (p.menu.snoozeOnly) {
      const store = p.menu.store;
      const isSnoozed = store ? (map(store)[id]?.until ?? 0) > Date.now() : snoozed(id);
      const snooze = (_id, until) => (store ? snoozeStore(p.menu, until === "review" ? null : until) : snoozeSession(_id, until));
      const option = (key, text, until, onClick) => h_flex().id(`snooze-${key}`).h(32).px(10).gap(12).items_center().rounded(6).text_size(13).text_color(t.foreground)
        .cursor_pointer().hover((st) => st.bg(t.hover))
        .on_click((_e, cx) => onClick(cx))
        .child(div().flex_1().child(text))
        .when(Boolean(until), (el) => el.child(div().flex_none().text_size(12).text_color(t.dim).child(until ? snoozeHint(until) : "")));
      const custom = this.snoozeInput ? parseSnooze(this.snoozeInput.value()) : null;
      return v_flex().id("sessions-snooze").w_full().p(5).bg(t.popover)
        .children(SNOOZE.map(([key, text, until]) => option(key, typeof text === "function" ? text() : text, until(), () => { close(); snooze(id, until()); })))
        .when(Boolean(p.menu.prOpen) && !store, (el) => el.child(option("review", "Until approved or commented", null, () => { close(); snooze(id, "review"); })))
        .child(line())
        .when(!this.customOpen, (el) => el.child(option("custom", "Custom…", null, (cx) => { this.customOpen = true; this.snoozeInput.focus(); cx.timer.after(40, () => this.snoozeInput.focus()); cx.notify(); })))
        .when(Boolean(this.customOpen), (el) => el.child(v_flex().px(6).pt(2).pb(4).gap(5)
          .child(Input.new(this.snoozeInput).h(28).px(8).rounded(6).border_1().border_color(custom ? t.accent : t.input).bg(t.background).text_size(12.5).text_color(t.foreground))
          .child(div().px(2).text_size(11.5).text_color(custom ? t.muted : t.dim).child(custom ? `Until ${snoozeHint(custom)} · Enter` : "45m, 2h, 17:30, fri 10:00"))))
        .when(isSnoozed, (el) => el.child(line()).child(option("unsnooze", "Unsnooze", null, () => { close(); snooze(id, null); })));
    }
    const open = Boolean(url) && p.menu.entry?.pr?.state === "OPEN";
    const toggle = (key, text, on, action, icon) => h_flex().id(`menu-${key}`).h(28).px(10).gap(8).items_center().rounded(6).text_size(12.5).text_color(t.foreground)
      .cursor_pointer().hover((st) => st.bg(t.hover))
      .on_click(() => { close(); action(); })
      .child(svg(icon).size(13).flex_none().text_color(on ? t.accent : t.muted))
      .child(div().flex_1().truncate().child(text))
      .child(div().flex_none().px(6).py(1).rounded(4).text_size(11).when(on, (el) => el.bg(t.selected).text_color(t.foreground)).when(!on, (el) => el.text_color(t.dim)).child(on ? "On" : "Off"));
    const autoMerge = Boolean(p.menu.entry?.pr?.autoMergeRequest) || Boolean(mergeWaiting(id));
    const updateFrom = p.menu.entry?.branch && !DEFAULT_BRANCHES.has(p.menu.entry.branch) ? (p.menu.entry.pr?.baseRefName || this.defaultBranch || null) : null;
    const noAutoSettle = Boolean(map("sessions.noAutoSettle")[id]);
    return v_flex().id("sessions-menu").w_full().p(4).bg(t.popover)
      .when(id !== shared("sessions.dev"), (el) => el.child(item("focus", starred ? "Remove from focus" : "Add to focus", () => star(id, !starred), ICON(starred ? "bulb-fill" : "bulb"))))
      .child(item("settle", "Settle", () => request({ kind: "settle", entry: p.menu.entry }), ICON("check")))
      .when(starred, (el) => el.child(line()))
      .when(starred, (el) => el.child(item("snooze", isSnoozed ? `Snoozed until ${snoozeLabel(id)}…` : "Snooze…", () => openOverlay({ mod: "sessions", kind: "popup", width: 280, height: 300, props: { menu: { id, snoozeOnly: true, prOpen: open } } }), ICON("clock"))))
      .when(starred, (el) => el.child(item("pin", pinned(id) ? "Unpin" : "Pin", () => setPinned(id, !pinned(id)), `mods/workspace-chrome/${pinned(id) ? "pin-off" : "pin"}.svg`)))
      .when(Boolean(updateFrom), (el) => el.child(line()).child(item("update-base", `Update from ${updateFrom}`, () => {
        const space = spaces().find((s) => s.id === id);
        if (space) this.sendToClaude(space, `Merge the latest ${updateFrom} into this branch: git fetch origin ${updateFrom}, then git merge origin/${updateFrom}. Fix the conflicts. Use the repo's generators for generated files. Run the specs of the files that had conflicts, then commit the merge. If a conflict is not clear, stop and ask me.`);
      }, "mods/workspace-chrome/branch.svg")))
      .when(Boolean(url), (el) => el.child(line()).child(label("Automatically")))
      .when(open, (el) => el.child(toggle("autofix", "Fix", Boolean(map("pr.autoFix")[id]), () => setAutoFix(id, !map("pr.autoFix")[id]), ICON("wrench"))))
      .when(open && (!p.menu.entry?.pr?.stacked || autoMerge), (el) => el.child(toggle("auto-merge", "Merge", autoMerge, () => request({ kind: "automerge", entry: p.menu.entry, on: !autoMerge }), ICON("git-merge-queue"))))
      .when(Boolean(url), (el) => el.child(toggle("auto-settle", "Settle", !noAutoSettle, () => {
        const all = { ...map("sessions.noAutoSettle") };
        if (noAutoSettle) delete all[id];
        else all[id] = true;
        setShared("sessions.noAutoSettle", all);
      }, ICON("check-check"))))
      .child(line())
      .child(item("remove", "Remove", () => run("space.close", { id, confirmed: true }), "mods/workspace-chrome/x.svg"))
      .child(line())
      .when(Boolean(url), (el) => el.child(item("github", "Open pull request on GitHub", () => exec("open", [url]), ICON("external-link"))))
      .child(item("rename", "Rename", () => run("space.rename", { id }), "mods/workspace-chrome/square-pen.svg"))
      .when(sections.length > 0 || Boolean(membership[id]), (el) => el.child(line()))
      .when(sections.length > 0, (el) => el.child(label("Move to section")).children(sections.filter((s) => membership[id] !== s.id).map((s) => item(`move-${s.id}`, s.name, () => moveTo(id, s.id), "mods/workspace-chrome/layers.svg"))))
      .when(Boolean(membership[id]), (el) => el.child(item("unsection", "Remove from section", () => moveTo(id, null), "mods/workspace-chrome/minus.svg")));
  }
}
