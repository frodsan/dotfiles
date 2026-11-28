import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, TextView, TextareaState, Textarea } from "gpui-base";
import { exec, run, theme, shared, setShared, props, openOverlay, closeOverlay, settings, readTextFile, writeTextFile, appHome } from "herdr";

const ICON = (name) => `mods/reviews/assets/${name}.svg`;
const SICON = (name) => `mods/sessions/assets/${name}.svg`;
const conf = () => shared("firehouse.settings") ?? {};
const base = (path) => (path ?? "").replace(/\/+$/, "").split("/").pop() || "~";
const DAY_MS = 24 * 60 * 60000;
const refreshMs = () => (conf().reviewsRefreshMinutes ?? 5) * 60000;

const REVIEWS_QUERY = `query {
  search(query: "is:pr is:open archived:false user-review-requested:@me sort:updated-desc", type: ISSUE, first: 50) {
    nodes { ... on PullRequest {
      number title url isDraft createdAt updatedAt body additions deletions changedFiles headRefName baseRefName headRefOid reviewDecision
      author { login ... on User { name } }
      repository { nameWithOwner }
      latestReviews(first: 20) { nodes { state author { __typename login } } }
      reviewRequests(first: 20) { nodes { asCodeOwner requestedReviewer { ... on User { login } ... on Team { slug } } } }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    } }
  }
}`;

const COMMENTS_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes { __typename ... on CheckRun { name status conclusion detailsUrl startedAt completedAt checkSuite { workflowRun { workflow { name } } } } ... on StatusContext { context state targetUrl } } } } } } }
    reviews(states: PENDING, first: 1) { nodes { id comments { totalCount } } }
    reviewThreads(first: 100) { nodes { id isResolved isOutdated path line diffSide comments(first: 50) { nodes { id url state author { __typename login } body createdAt reactionGroups { content viewerHasReacted reactors { totalCount } } } } } }
    timelineItems(last: 60, itemTypes: [PULL_REQUEST_REVIEW, ISSUE_COMMENT]) {
      nodes {
        __typename
        ... on PullRequestReview { id url state body createdAt author { __typename login } comments { totalCount } reactionGroups { content viewerHasReacted reactors { totalCount } } }
        ... on IssueComment { id url body createdAt author { __typename login } reactionGroups { content viewerHasReacted reactors { totalCount } } }
      }
    }
  } }
}`;


const SNOOZED = "reviews.snoozed";
const settledMs = () => (conf().reviewsKeepDays ?? 1) * DAY_MS;
const items = () => shared("reviews.list")?.items ?? [];
const settledReviews = () => shared("reviews.settled") ?? {};
const snoozedUntil = (pr) => {
  const entry = (shared(SNOOZED) ?? {})[pr.url];
  return entry && entry.until > Date.now() && (!entry.head || entry.head === pr.headRefOid) ? entry.until : 0;
};
const isSnoozed = (pr) => snoozedUntil(pr) > 0;
const isBot = (author) => author?.__typename === "Bot";
const findPr = (url) => items().find((p) => p.url === url) ?? settledReviews()[url]?.pr ?? null;

function ago(iso) {
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

function plainBody(body) {
  return (body ?? "")
    .replace(/<!-{2,3} start of ([\w-]+) -->[\s\S]*?<!-{2,3} end of \1 -->/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => `[${text.replace(/<[^>]+>/g, "").trim() || href}](${href})`)
    .replace(/<br\s*\/?>/gi, ", ")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const EMPTY_SECTION = /^\s*(n\/?a|none|-+|—|\.|_+|tbd)?\s*$/i;
function dropEmptySections(markdown) {
  const parts = markdown.split(/^(?=#{1,6}\s)/m).map((text) => {
    const match = text.match(/^(#{1,6})\s[^\n]*\n?([\s\S]*)$/);
    return { text, level: match ? match[1].length : 0, filled: !EMPTY_SECTION.test(match ? match[2] : text) };
  });
  const keep = parts.map(() => false);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!parts[i].level) { keep[i] = parts[i].filled; continue; }
    let child = false;
    for (let j = i + 1; j < parts.length && parts[j].level > parts[i].level; j++) if (keep[j]) child = true;
    keep[i] = parts[i].filled || child;
  }
  return parts.filter((_p, i) => keep[i]).map((p) => p.text).join("").trim();
}

function ownersRegex(pattern) {
  let p = pattern;
  const anchored = p.startsWith("/") || p.replace(/\/$/, "").includes("/");
  p = p.replace(/^\//, "").replace(/\/$/, "");
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*" && p[i + 1] === "*") {
      if (p[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } else { re += ".*"; i += 1; }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${anchored ? "^" : "^(?:.*/)?"}${re}(?:/.*)?$`);
}

function parseOwners(text) {
  return text.split("\n").map((line) => line.replace(/#.*/, "").trim()).filter(Boolean).map((line) => {
    const [pattern, ...owners] = line.split(/\s+/);
    try { return { re: ownersRegex(pattern), owners: owners.map((o) => o.toLowerCase()) }; } catch { return null; }
  }).filter(Boolean);
}

function ownersOf(rules, path) {
  for (let i = rules.length - 1; i >= 0; i--) if (rules[i].re.test(path)) return rules[i].owners;
  return [];
}

const EMOJI = { THUMBS_UP: "👍", THUMBS_DOWN: "👎", LAUGH: "😄", HOORAY: "🎉", CONFUSED: "😕", HEART: "❤️", ROCKET: "🚀", EYES: "👀" };
const groups = (node) => (node?.reactionGroups ?? []).map((g) => ({ content: g.content, count: g.reactors?.totalCount ?? 0, mine: Boolean(g.viewerHasReacted) }));

function buildActivity(nodes) {
  const out = [];
  for (const n of nodes) {
    if (isBot(n.author)) continue;
    const actor = n.author?.login ?? "ghost";
    if (n.__typename === "IssueComment") { out.push({ id: n.id, url: n.url, type: "comment", actor, at: n.createdAt, body: n.body ?? "", reactions: groups(n) }); continue; }
    if (n.__typename !== "PullRequestReview" || n.state === "PENDING" || n.state === "DISMISSED") continue;
    const body = (n.body ?? "").trim();
    const inline = n.comments?.totalCount ?? 0;
    if (n.state === "COMMENTED" && !body && !inline) continue;
    out.push({ id: n.id, url: n.url, type: "review", state: n.state, actor, at: n.createdAt, body, inline, reactions: groups(n) });
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

function linkRefs(markdown, repo) {
  return markdown.split(/(```[\s\S]*?```|`[^`\n]*`)/).map((part, i) => (i % 2 ? part : part.replace(/(^|[^\w/[\]#&`])(?:([\w.-]+\/[\w.-]+))?#(\d+)\b(?!\])/g,
    (_m, before, other, number) => `${before}[${other ? `${other}#` : "#"}${number}](https://github.com/${other ?? repo}/pull/${number})`))).join("");
}

function selectReview(url) {
  setShared("reviews.selected", url);
  run("layout.select", { stack: "views", child: "reviews-view" });
}

export default class Reviews extends View {
  init(_props, cx) {
    if (props()?.watch) return this.initWatch(cx);
    if (props()?.menu) return;
    if (props()?.view) {
      this.details = {};
      this.rules = {};
      this.me = {};
      this.toggled = new Set();
      this.newComment = TextareaState.new({ placeholder: "Leave a comment", rows: 3 });
      this.newComment.on("change", (_e, cx) => cx.notify());
      this.reviewBody = TextareaState.new({ placeholder: "Leave a comment", rows: 4 });
      this.reviewBody.on("change", (_e, cx) => cx.notify());
      this.fileFilter = null;
      this.tab = ["files", "checks"].includes(localStorage.getItem("tab")) ? localStorage.getItem("tab") : "description";
      this.shown = null;
      cx.timer.every(2000, (cx) => cx.notify());
      return;
    }
    cx.timer.every(30000, (cx) => cx.notify());
  }

  initWatch(cx) {
    cx.timer.every(2000, (cx) => this.runReviews(cx));
  }

  runReviews(cx) {
    const data = shared("reviews.list");
    const asked = shared("reviews.refresh") ?? 0;
    if (this.reviewsLoading || (Date.now() - (data?.at ?? 0) < refreshMs() && asked <= (data?.at ?? 0))) return;
    this.reviewsLoading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("gh", ["api", "graphql", "-f", `query=${REVIEWS_QUERY}`]).catch(() => null);
        if (r?.code !== 0) {
          setShared("reviews.list", { ...(data ?? { items: [] }), at: Date.now(), error: "Could not load review requests. Is gh logged in?" });
          return;
        }
        const list = (JSON.parse(r.stdout).data?.search?.nodes ?? []).filter((n) => n?.url).map((n) => ({
          number: n.number, title: n.title, url: n.url, isDraft: n.isDraft, createdAt: n.createdAt, updatedAt: n.updatedAt, body: n.body,
          additions: n.additions, deletions: n.deletions, changedFiles: n.changedFiles, headRefName: n.headRefName, baseRefName: n.baseRefName,
          headRefOid: n.headRefOid, reviewDecision: n.reviewDecision, author: n.author?.login ?? "ghost", authorName: n.author?.name || null,
          repo: n.repository.nameWithOwner,
          reviews: n.latestReviews.nodes.map((v) => ({ state: v.state, author: v.author?.login ?? "ghost", bot: isBot(v.author) })),
          requested: (n.reviewRequests?.nodes ?? []).map((q) => ({ name: q.requestedReviewer?.login ?? (q.requestedReviewer?.slug ? `team ${q.requestedReviewer.slug}` : null), owner: Boolean(q.asCodeOwner) })).filter((q) => q.name),
          ci: n.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null,
        }));
        const open = new Set(list.map((pr) => pr.url));
        const fetchedAt = Date.now();
        const settled = { ...settledReviews() };
        for (const [url, entry] of Object.entries(settled)) {
          if (fetchedAt - entry.at > settledMs() || (open.has(url) && entry.at < (data?.at ?? 0))) delete settled[url];
        }
        const gone = (data?.items ?? []).filter((pr) => !open.has(pr.url) && !settled[pr.url]);
        if (gone.length) {
          const query = `query { ${gone.map((pr, i) => `r${i}: resource(url: ${JSON.stringify(pr.url)}) { ... on PullRequest { state viewerLatestReview { state } } }`).join(" ")} }`;
          const g = await exec("gh", ["api", "graphql", "-f", `query=${query}`]).catch(() => null);
          const found = g?.code === 0 ? JSON.parse(g.stdout).data ?? {} : {};
          gone.forEach((pr, i) => {
            const node = found[`r${i}`] ?? {};
            const mine = node.viewerLatestReview?.state;
            const reason = node.state === "MERGED" ? "merged" : node.state === "CLOSED" ? "closed" : mine === "APPROVED" ? "approved" : mine === "CHANGES_REQUESTED" ? "changes requested" : mine === "COMMENTED" ? "commented" : "no longer requested";
            settled[pr.url] = { pr, reason, at: fetchedAt };
          });
        }
        setShared("reviews.settled", settled);
        const snoozed = shared(SNOOZED) ?? {};
        const kept = Object.fromEntries(Object.entries(snoozed).filter(([url, v]) => open.has(url) && v.until > fetchedAt));
        if (Object.keys(kept).length !== Object.keys(snoozed).length) setShared(SNOOZED, kept);
        setShared("reviews.list", { items: list, at: fetchedAt, error: null });
      } finally {
        this.reviewsLoading = false;
        cx.notify();
      }
    });
  }

  snooze(pr) {
    openOverlay({ mod: "sessions", kind: "popup", width: 280, height: 300, props: { menu: { id: pr.url, snoozeOnly: true, store: SNOOZED, extra: { head: pr.headRefOid } } } });
  }

  checkout(pr) {
    setShared("sessions.checkout", { url: pr.url, at: Date.now() });
    run("sessions.checkout-pr");
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
      .child(item("checkout", "Check out", ICON("branch"), () => this.checkout(pr)))
      .child(div().my(4).h(1).bg(t.border))
      .child(item("snooze", isSnoozed(pr) ? `Snoozed until ${when(snoozedUntil(pr))}…` : "Snooze…", ICON("clock"), () => this.snooze(pr)))
      .child(div().my(4).h(1).bg(t.border))
      .child(item("github", "Open on GitHub", ICON("external-link"), () => exec("open", [pr.url])));
  }

  repoGroups(waiting, row, t) {
    const collapsed = new Set(JSON.parse(localStorage.getItem("reviews.collapsed") ?? "[]"));
    const groups = new Map();
    for (const pr of waiting) {
      const repo = base(pr.repo);
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

  folded(id, icon, title, rows, t) {
    if (!rows.length) return [];
    const open = localStorage.getItem(`reviews.${id}.open`) === "1";
    const head = h_flex().id(`reviews-${id}`).mt(12).px(6).py(4).gap(6).items_center().rounded(6).text_size(12).text_color(t.dim).cursor_pointer().hover((st) => st.bg(t.hover))
      .on_click((_e, cx) => { localStorage.setItem(`reviews.${id}.open`, open ? "0" : "1"); cx.notify(); })
      .child(svg(ICON(open ? "chevron-down" : "chevron-right")).size(12).flex_none())
      .child(svg(icon).size(12).flex_none())
      .child(div().flex_1().font_medium().child(`${title} · ${rows.length}`));
    return open ? [head, ...rows] : [head];
  }

  renderList() {
    const t = theme();
    const data = shared("reviews.list");
    const settled = settledReviews();
    const live = items().filter((pr) => !settled[pr.url]);
    const waiting = live.filter((pr) => !isSnoozed(pr));
    const sleeping = live.filter(isSnoozed).sort((a, b) => snoozedUntil(a) - snoozedUntil(b));
    const done = Object.values(settled).filter((e) => Date.now() - e.at < settledMs()).sort((a, b) => b.at - a.at);
    const selected = shared("reviews.selected");
    const row = (pr, grouped = false) => {
      const key = `review-${pr.url}`;
      const on = pr.url === selected;
      return h_flex().id(key).px(8).py(6).gap(8).items_center().rounded(8).cursor_pointer()
        .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((st) => st.bg(t.hover)))
        .on_click(() => selectReview(pr.url))
        .on_mouse_down("right", () => openOverlay({ mod: "reviews", kind: "popup", width: 240, height: 132, props: { menu: { pr } } }))
        .child(svg(ICON(pr.isDraft ? "pr-draft" : "pr-open")).size(13).flex_none().text_color(pr.isDraft ? t.dim : t.done))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().text_size(13).text_color(t.foreground).child(pr.title))
          .child(div().truncate().text_size(11).text_color(t.dim).child(isSnoozed(pr) ? `${base(pr.repo)}#${pr.number} · until ${when(snoozedUntil(pr))}` : `${grouped ? "" : base(pr.repo)}#${pr.number} · @${pr.author} · ${ago(pr.updatedAt)}`)));
    };
    const settledRow = (e) => h_flex().id(`review-settled-${e.pr.url}`).px(8).py(5).gap(8).items_center().rounded(6).cursor_pointer()
      .when(e.pr.url === selected, (el) => el.bg(t.selected)).when(e.pr.url !== selected, (el) => el.hover((st) => st.bg(t.hover)))
      .on_click(() => selectReview(e.pr.url))
      .child(svg(SICON("archive")).size(12).flex_none().text_color(t.dim))
      .child(v_flex().flex_1().min_w(0)
        .child(div().truncate().text_size(12.5).text_color(t.muted).child(e.pr.title))
        .child(div().truncate().text_size(11).text_color(e.reason === "approved" ? t.done : t.dim).child(`${base(e.pr.repo)}#${e.pr.number} · ${e.reason} ${when(e.at)}`)));
    return v_flex().size_full().min_h(0).bg(t.chrome).text_color(t.foreground)
      .child(h_flex().flex_none().px(14).pt(4).pb(2).gap(8).items_center()
        .child(div().flex_1().text_size(12.5).font_medium().child(data ? `Reviews · ${waiting.length}` : "Reviews"))
        .child(div().id("reviews-refresh").p(4).rounded(6).text_color(t.dim).cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground)).tooltip("Ask GitHub again now")
          .on_click(() => setShared("reviews.refresh", Date.now()))
          .child(svg(ICON("refresh")).size(12))))
      .when(Boolean(data?.error), (el) => el.child(div().flex_none().px(14).pb(4).text_size(11).text_color(t.blocked).child(data?.error ?? "")))
      .child(v_flex().id("reviews-list").flex_1().min_h(0).px(8).pb(14).gap(2).overflow_y_scrollbar()
        .when(!data, (el) => el.child(div().px(8).py(8).text_size(12.5).text_color(t.dim).child("Asking GitHub…")))
        .when(Boolean(data) && waiting.length === 0, (el) => el.child(div().px(8).py(8).text_size(12.5).text_color(t.dim).child("No reviews waiting for you.")))
        .children(this.repoGroups(waiting, row, t))
        .children(this.folded("snoozed", ICON("clock"), "Snoozed", sleeping.map((pr) => row(pr)), t))
        .children(this.folded("settled", SICON("check"), "Recently reviewed", done.map(settledRow), t)));
  }

  async identity(org) {
    const cached = this.me[org];
    if (cached && Date.now() - cached.at < DAY_MS) return cached;
    const who = await exec("gh", ["api", "user", "--jq", ".login"]).catch(() => null);
    const login = who?.code === 0 ? who.stdout.trim() : "";
    if (login) this.login = login;
    const query = `query { organization(login: ${JSON.stringify(org)}) { teams(first: 100, userLogins: [${JSON.stringify(login)}]) { nodes { slug } } } }`;
    const r = login ? await exec("gh", ["api", "graphql", "-f", `query=${query}`]).catch(() => null) : null;
    const teams = r?.code === 0 ? (JSON.parse(r.stdout).data?.organization?.teams?.nodes ?? []).map((n) => `@${org}/${n.slug}`.toLowerCase()) : [];
    this.me[org] = { mine: new Set([`@${login}`.toLowerCase(), ...teams]), at: Date.now() };
    return this.me[org];
  }

  async ownerRules(repo, ref) {
    const key = `${repo}@${ref}`;
    const cached = this.rules[key];
    if (cached && Date.now() - cached.at < DAY_MS) return cached.rules;
    let rules = [];
    for (const path of [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"]) {
      const r = await exec("gh", ["api", `repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`, "-H", "Accept: application/vnd.github.raw"]).catch(() => null);
      if (r?.code === 0) { rules = parseOwners(r.stdout); break; }
    }
    this.rules[key] = { rules, at: Date.now() };
    return rules;
  }

  load(pr, cx) {
    const key = `${pr.url}@${pr.headRefOid}`;
    if (this.details[key]) return this.details[key];
    this.details[key] = { loading: true };
    cx.spawn(async (cx) => {
      try {
        const [owner, name] = pr.repo.split("/");
        const [me, rules, files, talk, viewed] = await Promise.all([
          this.identity(owner),
          this.ownerRules(pr.repo, pr.baseRefName),
          exec("gh", ["api", "--paginate", `repos/${pr.repo}/pulls/${pr.number}/files?per_page=100`, "--jq", ".[] | {filename, status, additions, deletions, patch}"]),
          exec("gh", ["api", "graphql", "-f", `query=${COMMENTS_QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${pr.number}`]).catch(() => null),
          this.viewedStates(pr),
        ]);
        const data = talk?.code === 0 ? JSON.parse(talk.stdout).data?.repository?.pullRequest : null;
        const person = (c) => ({ id: c.id, url: c.url, pending: c.state === "PENDING", author: c.author?.login ?? "ghost", bot: isBot(c.author), body: c.body ?? "", at: c.createdAt, reactions: groups(c) });
        const threads = (data?.reviewThreads?.nodes ?? []).map((th) => ({ id: th.id, resolved: th.isResolved, outdated: th.isOutdated, path: th.path, line: th.line, side: th.diffSide, comments: th.comments.nodes.map(person) }));
        const activity = buildActivity(data?.timelineItems?.nodes ?? []);
        const checks = { passed: 0, pending: 0, failing: 0, list: [] };
        for (const c of data?.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []) {
          const state = c.__typename === "CheckRun" ? (c.status !== "COMPLETED" ? "PENDING" : c.conclusion) : c.state;
          const kind = ["SUCCESS", "NEUTRAL"].includes(state) ? "passed" : ["PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS"].includes(state) ? "pending" : state === "SKIPPED" ? "skipped" : "failing";
          if (kind !== "skipped") checks[kind] += 1;
          const seconds = c.startedAt && c.completedAt ? Math.round((Date.parse(c.completedAt) - Date.parse(c.startedAt)) / 1000) : null;
          checks.list.push({ kind, state, name: c.name ?? c.context ?? "check", workflow: c.checkSuite?.workflowRun?.workflow?.name ?? null, url: c.detailsUrl ?? c.targetUrl ?? null, seconds });
        }
        if (files.code !== 0) throw new Error(files.stderr.trim() || "Could not load the files");
        const list = files.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line)).map((file) => {
          const owners = ownersOf(rules, file.filename);
          return { ...file, owners, mine: owners.some((o) => me.mine.has(o)), viewed: viewed.states[file.filename] === "VIEWED", threads: threads.filter((th) => th.path === file.filename) };
        });
        this.details[key] = { files: list, hasRules: rules.length > 0, activity, checks, threads, prId: viewed.id, pending: data?.reviews?.nodes?.[0] ? { id: data.reviews.nodes[0].id, count: data.reviews.nodes[0].comments?.totalCount ?? 0 } : null, loadedComments: Boolean(data) };
      } catch (error) {
        this.details[key] = { error: String(error.message ?? error) };
      }
      cx.notify();
    });
    return this.details[key];
  }

  comment(t, c, th = null) {
    return v_flex().gap(4)
      .child(h_flex().gap(6).text_size(11.5).text_color(t.dim)
        .child(div().font_semibold().text_color(t.muted).child(c.author))
        .when(Boolean(c.bot), (el) => el.child(div().child("bot")))
        .when(Boolean(c.pending), (el) => el.child(div().px(6).rounded(8).bg(t.raised).text_color(t.working).child("Pending")))
        .when(Boolean(c.state) && c.state !== "COMMENTED", (el) => el.child(div().text_color(c.state === "APPROVED" ? t.done : c.state === "CHANGES_REQUESTED" ? t.blocked : t.dim).child((c.state ?? "").toLowerCase().replace(/_/g, " "))))
        .child(div().child(`${ago(c.at)} ago`)))
      .child(div().text_size(12.5).child(TextView.markdown(`comment-${c.id}`, linkRefs(plainBody(c.body).slice(0, 8000), this.repo) || "_(empty)_").selectable(true)))
      .child(this.reactionsRow(t, c.id, c.reactions, th ? this.commentActions(t, c, (cx, quoted) => {
        if (!(this.draft?.kind === "reply" && this.draft.thread === th.id)) this.startDraft({ kind: "reply", thread: th.id }, cx);
        const current = this.draft.state.value().trim();
        this.draft.state.set_value(`${current ? `${current}\n\n` : ""}${quoted}\n\n`);
        this.previews?.delete("draft");
        this.draft.state.focus?.();
      }) : null));
  }

  thread(t, th) {
    this.openThreads ??= new Set();
    this.closedThreads ??= new Set();
    const open = th.resolved ? this.openThreads.has(th.id) : !this.closedThreads.has(th.id);
    const first = th.comments[0];
    const head = h_flex().id(`thread-${th.id}`).gap(6).items_center().text_size(11.5).text_color(t.dim).cursor_pointer()
      .on_click((_e, cx) => {
        const set = th.resolved ? this.openThreads : this.closedThreads;
        if (set.has(th.id)) set.delete(th.id); else set.add(th.id);
        cx.notify();
      })
      .child(div().flex_none().child(open ? "▾" : "▸"))
      .child(div().flex_none().child(th.resolved ? "✓ Resolved" : th.outdated ? "Outdated" : `${th.comments.length} comment${th.comments.length === 1 ? "" : "s"}`))
      .when(!open, (el) => el.child(div().min_w(0).truncate().child(`· ${first?.author ?? ""}: ${(first?.body ?? "").split("\n")[0].slice(0, 120)}`)))
      .child(div().flex_1())
      .child(div().id(`resolve-${th.id}`).flex_none().px(8).py(2).rounded(6).text_size(11.5).text_color(t.muted).border_1().border_color(t.border).cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); this.resolveThread(th, cx); })
        .child(this.busyThread === th.id ? "…" : th.resolved ? "Unresolve" : "Resolve"));
    return v_flex().mx(14).my(6).px(12).py(8).gap(8).rounded(8).border_l_2().border_color(th.resolved ? t.border : t.accent).bg(t.raised)
      .when(th.resolved, (el) => el.opacity(0.7))
      .child(head)
      .when(open, (el) => el.children(th.comments.map((c) => this.comment(t, c, th))))
      .when(open && !(this.draft?.kind === "reply" && this.draft.thread === th.id), (el) => el.child(h_flex().child(div().id(`reply-${th.id}`).px(10).py(4).rounded(6).text_size(12).text_color(t.muted).border_1().border_color(t.border).cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { this.startDraft({ kind: "reply", thread: th.id }, cx); }).child("Reply"))))
      .when(this.draft?.kind === "reply" && this.draft.thread === th.id, (el) => el.child(this.draftBox(t)));
  }

  splitDiff(t, file) {
    const threads = file.threads ?? [];
    const placed = new Set();
    const lines = file.patch.split("\n");
    const shown = lines.slice(0, 600);
    const mono = settings().font_family;
    const rows = [];
    const after = (spots) => {
      for (const spot of spots) {
        if (!spot) continue;
        if (this.draft?.kind === "line" && this.draft.path === spot.path && this.draft.side === spot.side && this.draft.line === spot.line) rows.push(this.draftBox(t));
        for (const th of threads) {
          if (placed.has(th.id) || th.line == null || (th.side ?? "RIGHT") !== spot.side || th.line !== spot.line) continue;
          placed.add(th.id);
          rows.push(this.thread(t, th));
        }
      }
    };
    const half = (entry, side, kind) => {
      const spot = entry ? { path: file.filename, side, line: entry.n } : null;
      return h_flex().id(`half-${file.filename}-${rows.length}-${side}`).w("50%").min_w(0).overflow_hidden().font_family(mono).text_size(11.5)
        .when(side === "RIGHT", (el) => el.border_l_1().border_color(t.border))
        .when(Boolean(spot), (el) => el.cursor_pointer().hover((st) => st.bg(t.hover)).on_click((_e, cx) => { this.startDraft({ kind: "line", ...spot }, cx); }))
        .child(div().w(46).flex_none().pr(10).text_right().text_color(t.dim).child(entry ? String(entry.n) : ""))
        .child(div().flex_1().min_w(0).whitespace_nowrap().overflow_hidden()
          .text_color(kind === "del" ? t.blocked : kind === "add" ? t.done : t.muted)
          .child(entry ? (entry.text || " ") : " "));
    };
    const row = (left, right, leftKind, rightKind) => {
      rows.push(h_flex().id(`split-${file.filename}-${rows.length}`).w_full().child(half(left, "LEFT", leftKind)).child(half(right, "RIGHT", rightKind)));
      after([left ? { path: file.filename, side: "LEFT", line: left.n } : null, right ? { path: file.filename, side: "RIGHT", line: right.n } : null]);
    };
    let oldLine = 0;
    let newLine = 0;
    let dels = [];
    let adds = [];
    const flush = () => {
      for (let i = 0; i < Math.max(dels.length, adds.length); i++) row(dels[i] ?? null, adds[i] ?? null, dels[i] ? "del" : null, adds[i] ? "add" : null);
      dels = [];
      adds = [];
    };
    for (const line of shown) {
      const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/);
      if (hunk) {
        flush();
        oldLine = Number(hunk[1]);
        newLine = Number(hunk[2]);
        rows.push(div().px(14).mt(4).font_family(mono).text_size(11.5).whitespace_nowrap().text_color(t.dim).child(line));
      } else if (line.startsWith("\\")) continue;
      else if (line.startsWith("-")) dels.push({ n: oldLine++, text: line.slice(1) });
      else if (line.startsWith("+")) adds.push({ n: newLine++, text: line.slice(1) });
      else {
        flush();
        row({ n: oldLine++, text: line.slice(1) }, { n: newLine++, text: line.slice(1) }, null, null);
      }
    }
    flush();
    const loose = threads.filter((th) => !placed.has(th.id));
    return v_flex().id(`diff-${file.filename}`).border_t_1().border_color(t.border).py(4)
      .when(loose.length > 0, (el) => el.child(v_flex().pb(4).children(loose.map((th) => this.thread(t, th)))))
      .child(v_flex().children(rows))
      .when(lines.length > shown.length, (el) => el.child(div().px(14).py(4).text_size(12).text_color(t.dim).child(`${lines.length - shown.length} more lines on GitHub`)));
  }

  diff(t, file) {
    const threads = file.threads ?? [];
    const placed = new Set();
    if (!file.patch) return v_flex()
      .child(div().px(14).py(8).text_size(12).text_color(t.dim).child(file.status === "renamed" ? "Renamed, no changes." : "No diff to show (binary or too large). Open it on GitHub."))
      .children(threads.map((th) => this.thread(t, th)));
    if ((conf().reviewsDiffLayout ?? "split") === "split") return this.splitDiff(t, file);
    const lines = file.patch.split("\n");
    const shown = lines.slice(0, 600);
    const mono = settings().font_family;
    let oldLine = 0;
    let newLine = 0;
    const rows = [];
    for (const line of shown) {
      const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/);
      let at = null;
      if (hunk) { oldLine = Number(hunk[1]); newLine = Number(hunk[2]); }
      else if (line.startsWith("-")) { at = ["LEFT", oldLine]; oldLine += 1; }
      else if (line.startsWith("+")) { at = ["RIGHT", newLine]; newLine += 1; }
      else { at = ["RIGHT", newLine]; oldLine += 1; newLine += 1; }
      const spot = at ? { path: file.filename, side: at[0], line: at[1] } : null;
      rows.push(div().id(`line-${file.filename}-${rows.length}`).px(14).font_family(mono).text_size(11.5).whitespace_nowrap()
        .when(Boolean(spot), (el) => el.cursor_pointer().hover((st) => st.bg(t.hover)).on_click((_e, cx) => { this.startDraft({ kind: "line", ...spot }, cx); }))
        .when(line.startsWith("+"), (el) => el.text_color(t.done))
        .when(line.startsWith("-"), (el) => el.text_color(t.blocked))
        .when(line.startsWith("@@"), (el) => el.text_color(t.dim).mt(4))
        .when(!/^[+\-@]/.test(line), (el) => el.text_color(t.muted))
        .child(line || " "));
      if (spot && this.draft?.kind === "line" && this.draft.path === spot.path && this.draft.side === spot.side && this.draft.line === spot.line) rows.push(this.draftBox(t));
      if (at) for (const th of threads) {
        if (placed.has(th.id) || th.line == null || (th.side ?? "RIGHT") !== at[0] || th.line !== at[1]) continue;
        placed.add(th.id);
        rows.push(this.thread(t, th));
      }
    }
    const loose = threads.filter((th) => !placed.has(th.id));
    return v_flex().id(`diff-${file.filename}`).border_t_1().border_color(t.border).py(4)
      .when(loose.length > 0, (el) => el.child(v_flex().pb(4).children(loose.map((th) => this.thread(t, th)))))
      .child(v_flex().children(rows))
      .when(lines.length > shown.length, (el) => el.child(div().px(14).py(4).text_size(12).text_color(t.dim).child(`${lines.length - shown.length} more lines on GitHub`)));
  }

  ruleFor(pr, cx) {
    this.rulesets ??= {};
    const key = `${pr.repo}@${pr.baseRefName}`;
    const cached = this.rulesets[key];
    if (cached && (cached.loading || Date.now() - cached.at < DAY_MS)) return cached;
    this.rulesets[key] = { loading: true, at: Date.now() };
    cx.spawn(async (cx) => {
      const r = await exec("gh", ["api", `repos/${pr.repo}/rules/branches/${encodeURIComponent(pr.baseRefName)}`]).catch(() => null);
      const rules = r?.code === 0 ? JSON.parse(r.stdout).filter((x) => x.type === "pull_request").map((x) => x.parameters ?? {}) : [];
      this.rulesets[key] = { approvals: Math.max(0, ...rules.map((x) => x.required_approving_review_count ?? 0)), at: Date.now() };
      cx.notify();
    });
    return this.rulesets[key];
  }

  statusBar(t, pr, details, cx) {
    const segments = (parts) => {
      const total = parts.reduce((sum, [n]) => sum + n, 0);
      if (!total) return div().w_full().h(6).rounded(3).border_1().border_color(t.border);
      return h_flex().w_full().h(6).gap(2).rounded(3).overflow_hidden()
        .children(parts.filter(([n]) => n > 0).map(([n, color]) => div().h_full().bg(color).w(`${(n / total) * 100}%`)));
    };
    const card = (id, title, note, noteColor, bar, onClick, tip = null) => v_flex().id(`status-${id}`).flex_1().min_w(0).gap(10).px(14).py(12).cursor_pointer().hover((st) => st.bg(t.hover))
      .when(Boolean(tip), (el) => el.tooltip(tip ?? ""))
      .on_click((_e, cx) => { onClick(); cx.notify(); })
      .child(h_flex().gap(6).items_center()
        .child(div().flex_none().text_size(13).font_semibold().text_color(t.foreground).child(title))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(noteColor ?? t.dim).child(note))
        .child(svg(ICON("chevron-right")).size(12).flex_none().text_color(t.dim)))
      .child(bar);
    const ready = details && !details.loading && !details.error;
    const c = ready ? details.checks : { passed: 0, pending: 0, failing: 0 };
    const checkNote = !ready ? "Loading…" : c.failing ? `${c.failing} failing` : c.pending ? `${c.pending} running` : c.passed ? "All passed" : "None";
    const threads = ready ? details.threads ?? [] : [];
    const open = threads.filter((th) => !th.resolved).length;
    const threadNote = !ready ? "Loading…" : !threads.length ? "None" : open ? `${open} unresolved` : "All resolved";
    const rule = this.ruleFor(pr, cx);
    const people = (pr.reviews ?? []).filter((r) => !r.bot);
    const approved = people.filter((r) => r.state === "APPROVED").length;
    const changes = people.filter((r) => r.state === "CHANGES_REQUESTED").length;
    const need = rule.approvals ?? 0;
    const missing = Math.max(0, need - approved);
    const approvalNote = rule.loading ? "Loading…" : changes ? "Changes requested" : missing ? `${missing} still required` : approved ? "Approved" : "None required";
    const bar = h_flex()
      .child(card("checks", "Checks", checkNote, c.failing ? t.ansi1 : null, segments([[c.passed, t.done], [c.pending, t.working], [c.failing, t.ansi1]]), () => { this.tab = "checks"; localStorage.setItem("tab", "checks"); }))
      .child(div().w(1).h_full().flex_none().bg(t.border))
      .child(card("comments", "Comments", threadNote, open ? t.working : null, segments([[threads.length - open, t.done], [open, t.working]]), () => { this.tab = "files"; localStorage.setItem("tab", "files"); this.fileFilter = open ? "unresolved" : this.fileFilter; this.toggled = new Set(); }, threads.length ? `${threads.length - open} resolved, ${open} unresolved` : null))
      .child(div().w(1).h_full().flex_none().bg(t.border))
      .child(card("approvals", "Approvals", approvalNote, changes ? t.blocked : null, segments([[approved, t.done], [changes, t.blocked], [missing, t.dim]]), () => { this.approvalsOpen = !this.approvalsOpen; }));
    const label = { APPROVED: ["approved", t.done, "check"], CHANGES_REQUESTED: ["requested changes", t.blocked, "x"], COMMENTED: ["left a comment", t.dim, "overview"], DISMISSED: ["had a review dismissed", t.dim, null] };
    const person = (id, name, text, color, icon, note) => h_flex().id(`approval-${id}`).px(14).py(7).gap(10).items_center().text_size(12.5)
      .child(div().flex_none().font_semibold().text_color(t.foreground).child(name))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(text))
      .when(Boolean(note), (el) => el.child(div().flex_none().px(6).rounded(8).bg(t.raised).text_size(11).text_color(t.muted).child(note ?? "")))
      .child(icon ? svg(ICON(icon)).size(13).flex_none().text_color(color) : div().size(8).flex_none().rounded(4).bg(color));
    const waiting = (pr.requested ?? []).filter((q) => !people.some((r) => r.author === q.name));
    const bots = (pr.reviews ?? []).filter((r) => r.bot);
    const panel = v_flex().py(4)
      .children(waiting.map((q, i) => person(`req-${i}`, q.name, "has been requested to review", t.working, null, q.owner ? "owner" : null)))
      .children(people.map((r, i) => person(`rev-${i}`, r.author, (label[r.state] ?? ["reviewed"])[0], (label[r.state] ?? [null, t.dim])[1], (label[r.state] ?? [])[2] ?? null, null)))
      .children(bots.map((r, i) => person(`bot-${i}`, r.author, (label[r.state] ?? ["reviewed"])[0], t.dim, (label[r.state] ?? [])[2] ?? null, "bot")))
      .when(!waiting.length && !people.length && !bots.length, (el) => el.child(div().px(14).py(8).text_size(12.5).text_color(t.dim).child("No reviewers yet.")));
    return v_flex().rounded(10).border_1().border_color(t.border).overflow_hidden()
      .child(bar)
      .when(Boolean(this.approvalsOpen), (el) => el.child(div().h(1).bg(t.border)).child(panel));
  }

  checkCount(pr) {
    const d = this.details?.[`${pr.url}@${pr.headRefOid}`];
    return d?.checks?.list ? d.checks.list.length : null;
  }

  checksTab(t, details) {
    if (!details || details.loading) return div().text_size(12.5).text_color(t.dim).child("Loading checks…");
    if (details.error) return div().text_size(12.5).text_color(t.blocked).child(details.error);
    const list = details.checks?.list ?? [];
    if (!list.length) return div().text_size(12.5).text_color(t.dim).child("No checks on the latest commit.");
    const color = { failing: t.ansi1, pending: t.working, passed: t.done, skipped: t.dim };
    const duration = (s) => (s == null ? "" : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`);
    const row = (c, i) => h_flex().id(`check-${i}`).px(12).py(7).gap(10).items_center().text_size(12.5)
      .when(Boolean(c.url), (el) => el.cursor_pointer().hover((st) => st.bg(t.hover)).on_click(() => exec("open", [c.url])))
      .child(div().size(8).flex_none().rounded(4).bg(color[c.kind]))
      .child(div().flex_1().min_w(0).truncate().text_color(c.kind === "skipped" ? t.dim : t.foreground).child(c.workflow ? `${c.workflow} / ${c.name}` : c.name))
      .when(c.kind === "pending", (el) => el.child(div().flex_none().text_size(11.5).text_color(t.working).child("running")))
      .child(div().flex_none().text_size(11.5).text_color(t.dim).child(duration(c.seconds)))
      .when(Boolean(c.url), (el) => el.child(svg(ICON("external-link")).size(11).flex_none().text_color(t.dim)));
    const group = (kind, title, foldedByDefault) => {
      const rows = list.map((c, i) => [c, i]).filter(([c]) => c.kind === kind);
      if (!rows.length) return [];
      const key = `checks.${kind}.open`;
      const open = localStorage.getItem(key) == null ? !foldedByDefault : localStorage.getItem(key) === "1";
      return [v_flex().gap(6)
        .child(h_flex().id(`checks-${kind}`).gap(6).items_center().cursor_pointer()
          .on_click((_e, cx) => { localStorage.setItem(key, open ? "0" : "1"); cx.notify(); })
          .child(div().text_size(11).text_color(t.dim).child(open ? "▾" : "▸"))
          .child(div().text_size(11).font_semibold().text_color(t.muted).child(`${title.toUpperCase()} (${rows.length})`)))
        .when(open, (el) => el.child(v_flex().rounded(10).border_1().border_color(t.border).overflow_hidden().children(rows.map(([c, i]) => row(c, i)))))];
    };
    return v_flex().gap(18)
      .children(group("failing", "Failing", false))
      .children(group("pending", "Running", false))
      .children(group("passed", "Passed", true))
      .children(group("skipped", "Skipped", true));
  }

  commentActions(t, e, quote = null) {
    const pill = (id, label, icon, action) => h_flex().id(`${id}-${e.id}`).h(20).items_center().px(7).rounded(10).text_size(12).text_color(t.dim).border_1().border_color(t.border).cursor_pointer().hover((st) => st.bg(t.hover))
      .tooltip(label).on_click((_e, cx) => { cx.stop_propagation(); action(cx); cx.notify(); })
      .child(svg(ICON(icon)).size(12).flex_none());
    return h_flex().gap(4)
      .child(pill("quote", "Quote reply", "overview", (cx) => {
        const quoted = plainBody(e.body).split("\n").map((line) => `> ${line}`).join("\n");
        if (quote) return quote(cx, quoted);
        const current = this.newComment.value().trim();
        this.newComment.set_value(`${current ? `${current}\n\n` : ""}${quoted}\n\n`);
        this.previews?.delete("comment");
        this.newComment.focus?.();
      }))
      .when(Boolean(e.url), (el) => el.child(pill("link", "Copy link", "link", (cx) => cx.write_to_clipboard(e.url))));
  }

  reactionsRow(t, subjectId, list, extra = null) {
    const shown = (list ?? []).filter((g) => g.count > 0);
    const picking = this.picker === subjectId;
    const pill = (g) => h_flex().id(`react-${subjectId}-${g.content}`).h(20).items_center().px(7).rounded(10).text_size(12).cursor_pointer().border_1()
      .border_color(g.mine ? t.accent : t.border).bg(g.mine ? t.raised : t.background).text_color(t.muted).hover((st) => st.bg(t.hover))
      .on_click((_e, cx) => { cx.stop_propagation(); this.react(subjectId, g.content, g.mine, cx); })
      .child(`${EMOJI[g.content] ?? g.content} ${g.count}`);
    return v_flex().gap(4)
      .child(h_flex().gap(4).items_center().flex_wrap()
        .children(shown.map(pill))
        .child(h_flex().id(`react-${subjectId}-open`).h(20).items_center().px(7).rounded(10).text_size(12).cursor_pointer().text_color(t.dim).border_1().border_color(picking ? t.accent : t.border).hover((st) => st.bg(t.hover))
          .tooltip("Add a reaction").on_click((_e, cx) => { cx.stop_propagation(); this.picker = picking ? null : subjectId; cx.notify(); }).child("☺"))
        .when(Boolean(extra), (el) => el.child(extra)))
      .when(picking, (el) => el.child(h_flex().gap(2).p(4).rounded(10).border_1().border_color(t.border).bg(t.popover)
        .children(Object.entries(EMOJI).map(([content, emoji]) => {
          const mine = (list ?? []).some((g) => g.content === content && g.mine);
          return div().id(`pick-${subjectId}-${content}`).px(6).py(2).rounded(6).text_size(15).cursor_pointer().when(mine, (el) => el.bg(t.raised)).hover((st) => st.bg(t.hover))
            .on_click((_e, cx) => { cx.stop_propagation(); this.picker = null; this.react(subjectId, content, mine, cx); }).child(emoji);
        }))));
  }

  react(subjectId, content, mine, cx) {
    const pr = this.pr;
    if (!pr) return;
    const field = mine ? "removeReaction" : "addReaction";
    cx.spawn(async (cx) => {
      await exec("gh", ["api", "graphql", "-f", `query=mutation($s: ID!, $c: ReactionContent!) { ${field}(input: { subjectId: $s, content: $c }) { reaction { content } } }`, "-f", `s=${subjectId}`, "-f", `c=${content}`]).catch(() => null);
      this.reload(pr);
      cx.notify();
    });
  }

  resolveThread(th, cx) {
    const pr = this.pr;
    if (!pr || this.busyThread) return;
    this.busyThread = th.id;
    cx.notify();
    const field = th.resolved ? "unresolveReviewThread" : "resolveReviewThread";
    cx.spawn(async (cx) => {
      await exec("gh", ["api", "graphql", "-f", `query=mutation($t: ID!) { ${field}(input: { threadId: $t }) { thread { isResolved } } }`, "-f", `t=${th.id}`]).catch(() => null);
      this.busyThread = null;
      this.reload(pr);
      cx.notify();
    });
  }

  reload(pr) {
    delete this.details[`${pr.url}@${pr.headRefOid}`];
    setShared("reviews.refresh", Date.now());
  }

  input(t, state, rows, key) {
    this.previews ??= new Set();
    const preview = this.previews.has(key);
    const toggle = (id, label, on) => div().id(`${key}-${id}`).px(8).py(3).rounded(6).text_size(12).cursor_pointer()
      .when(on, (el) => el.bg(t.raised).text_color(t.foreground)).when(!on, (el) => el.text_color(t.dim).hover((st) => st.text_color(t.foreground)))
      .on_click((_e, cx) => { if (id === "preview") this.previews.add(key); else this.previews.delete(key); cx.notify(); })
      .child(label);
    const text = state.value().trim();
    return v_flex().gap(6)
      .child(h_flex().gap(4).child(toggle("write", "Write", !preview)).child(toggle("preview", "Preview", preview)))
      .child(div().w_full().min_h(rows * 22).rounded(8).border_1().border_color(t.input).bg(t.background).p(8)
        .when(!preview, (el) => el.child(Textarea.new(state).size_full().text_size(12.5).text_color(t.foreground)))
        .when(preview, (el) => el.text_size(12.5).text_color(text ? t.foreground : t.dim)
          .child(text ? TextView.markdown(`${key}-preview-${text.length}`, linkRefs(text, this.repo)).selectable(true) : "Nothing to preview.")));
  }

  sendButton(t, id, label, busy, onClick) {
    return div().id(id).px(12).py(5).rounded(7).text_size(12.5).bg(t.solid).text_color(t.solid_foreground)
      .when(!busy, (el) => el.cursor_pointer().hover((st) => st.opacity(0.88)).on_click(onClick))
      .when(busy, (el) => el.opacity(0.6))
      .child(busy ? "Posting…" : label);
  }

  commentBox(t) {
    const pr = this.pr;
    const busy = this.posting === "comment";
    return v_flex().gap(8)
      .child(this.input(t, this.newComment, 3, "comment"))
      .child(h_flex().gap(10).items_center()
        .child(div().flex_1().text_size(11.5).text_color(t.blocked).child(this.postError?.where === "comment" ? this.postError.text : ""))
        .child(this.sendButton(t, "comment-send", "Comment", busy, (_e, cx) => {
          const body = this.newComment.value().trim();
          if (!body || !pr) return;
          this.posting = "comment";
          this.postError = null;
          cx.notify();
          cx.spawn(async (cx) => {
            const r = await exec("gh", ["api", `repos/${pr.repo}/issues/${pr.number}/comments`, "-f", `body=${body}`]).catch((e) => ({ code: 1, stderr: String(e) }));
            this.posting = null;
            if (r.code === 0) { this.newComment.set_value(""); this.previews?.delete("comment"); this.reload(pr); }
            else this.postError = { where: "comment", text: (r.stderr ?? "").trim().split("\n")[0] || "Could not post the comment." };
            cx.notify();
          });
        })));
  }

  startDraft(target, cx) {
    const state = TextareaState.new({ placeholder: target.kind === "reply" ? "Reply" : "Comment on this line", rows: 3 });
    state.on("change", (_e, cx) => cx.notify());
    this.draft = { ...target, state };
    this.previews?.delete("draft");
    this.postError = null;
    cx.timer.after(40, () => state.focus?.());
    cx.notify();
  }

  draftBox(t) {
    const pr = this.pr;
    const draft = this.draft;
    const busy = this.posting === "draft";
    return v_flex().mx(14).my(6).gap(8).p(10).rounded(8).border_1().border_color(t.border).bg(t.raised)
      .child(this.input(t, draft.state, 3, "draft"))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().text_size(11.5).text_color(t.blocked).child(this.postError?.where === "draft" ? this.postError.text : ""))
        .child(div().id("draft-cancel").px(12).py(5).rounded(7).text_size(12.5).text_color(t.muted).border_1().border_color(t.border).cursor_pointer().hover((st) => st.bg(t.hover))
          .on_click((_e, cx) => { this.draft = null; cx.notify(); }).child("Cancel"))
        .child(this.sendButton(t, "draft-send", draft.kind === "reply" ? "Reply" : "Comment", busy, (_e, cx) => {
          const body = draft.state.value().trim();
          if (!body || !pr) return;
          this.posting = "draft";
          this.postError = null;
          cx.notify();
          cx.spawn(async (cx) => {
            const args = draft.kind === "reply"
              ? ["api", "graphql", "-f", "query=mutation($t: ID!, $b: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $t, body: $b }) { comment { id } } }", "-f", `t=${draft.thread}`, "-f", `b=${body}`]
              : ["api", `repos/${pr.repo}/pulls/${pr.number}/comments`, "-f", `body=${body}`, "-f", `commit_id=${pr.headRefOid}`, "-f", `path=${draft.path}`, "-F", `line=${draft.line}`, "-f", `side=${draft.side}`];
            const r = await exec("gh", args).catch((e) => ({ code: 1, stderr: String(e) }));
            this.posting = null;
            if (r.code === 0) { this.draft = null; this.reload(pr); }
            else this.postError = { where: "draft", text: (r.stderr ?? "").trim().split("\n")[0] || "Could not post the comment." };
            cx.notify();
          });
        }))
        .child(this.sendButton(t, "draft-review", this.currentPending() ? (draft.kind === "reply" ? "Add to review" : "Add review comment") : "Start a review", this.posting === "review-draft", (_e, cx) => this.addToReview(draft, cx))));
  }

  currentPending() {
    const pr = this.pr;
    return pr ? this.details?.[`${pr.url}@${pr.headRefOid}`]?.pending ?? null : null;
  }

  async gql(query, vars) {
    const args = ["api", "graphql", "-f", `query=${query}`];
    for (const [k, v] of Object.entries(vars)) args.push(typeof v === "number" ? "-F" : "-f", `${k}=${v}`);
    const r = await exec("gh", args).catch((e) => ({ code: 1, stderr: String(e) }));
    if (r.code !== 0) throw new Error((r.stderr ?? "").trim().split("\n")[0] || "GitHub refused the request.");
    const out = JSON.parse(r.stdout);
    if (out.errors?.length) throw new Error(out.errors[0].message);
    return out.data;
  }

  async pendingReviewId(pr) {
    const key = `${pr.url}@${pr.headRefOid}`;
    const existing = this.details?.[key]?.pending?.id;
    if (existing) return existing;
    const prId = this.details?.[key]?.prId;
    if (!prId) throw new Error("The pull request is still loading.");
    const data = await this.gql("mutation($p: ID!, $c: GitObjectID!) { addPullRequestReview(input: { pullRequestId: $p, commitOID: $c }) { pullRequestReview { id } } }", { p: prId, c: pr.headRefOid });
    return data.addPullRequestReview.pullRequestReview.id;
  }

  addToReview(draft, cx) {
    const pr = this.pr;
    const body = draft.state.value().trim();
    if (!body || !pr) return;
    this.posting = "review-draft";
    this.postError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const review = await this.pendingReviewId(pr);
        if (draft.kind === "reply") await this.gql("mutation($r: ID!, $t: ID!, $b: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewId: $r, pullRequestReviewThreadId: $t, body: $b }) { comment { id } } }", { r: review, t: draft.thread, b: body });
        else await this.gql("mutation($r: ID!, $path: String!, $l: Int!, $s: DiffSide!, $b: String!) { addPullRequestReviewThread(input: { pullRequestReviewId: $r, path: $path, line: $l, side: $s, body: $b }) { thread { id } } }", { r: review, path: draft.path, l: draft.line, s: draft.side, b: body });
        this.draft = null;
        this.reload(pr);
      } catch (error) {
        this.postError = { where: "draft", text: error.message };
      }
      this.posting = null;
      cx.notify();
    });
  }

  checkoutButton(t, pr) {
    return h_flex().id("review-checkout").flex_none().h(30).px(12).gap(6).items_center().rounded(7).text_size(12.5).cursor_pointer()
      .bg(t.raised).border_1().border_color(t.border).hover((st) => st.bg(t.hover))
      .tooltip("Open the pull request's branch in a new session with focus mode")
      .on_click(() => this.checkout(pr))
      .child(svg(ICON("branch")).size(13).flex_none())
      .child("Check out");
  }

  reviewButton(t, pr, details) {
    const count = details?.pending?.count ?? 0;
    return h_flex().id("review-changes").flex_none().h(30).px(12).gap(6).items_center().rounded(7).text_size(12.5).cursor_pointer()
      .bg(t.solid).text_color(t.solid_foreground).hover((st) => st.opacity(0.88))
      .on_click((_e, cx) => { this.finishing = !this.finishing; this.postError = null; if (this.finishing && this.tab !== "files") { this.tab = "files"; localStorage.setItem("tab", "files"); } cx.notify(); })
      .child("Review changes")
      .when(count > 0, (el) => el.child(div().px(6).rounded(8).bg(t.background).text_size(11).text_color(t.foreground).child(String(count))));
  }

  finishPanel(t, pr, details) {
    const kinds = [["COMMENT", "Comment", "Submit general feedback without explicit approval."], ["APPROVE", "Approve", "Submit feedback and approve merging these changes."], ["REQUEST_CHANGES", "Request changes", "Submit feedback that must be addressed before merging."]];
    const pick = this.reviewEvent ?? "COMMENT";
    const busy = this.posting === "review";
    const option = ([id, title, hint]) => h_flex().id(`event-${id}`).gap(10).items_start().py(4).cursor_pointer()
      .on_click((_e, cx) => { this.reviewEvent = id; cx.notify(); })
      .child(div().mt(2).size(14).flex_none().rounded(7).border_2().border_color(pick === id ? t.accent : t.dim).when(pick === id, (el) => el.bg(t.accent)))
      .child(v_flex().child(div().text_size(13).font_semibold().child(title)).child(div().text_size(12).text_color(t.dim).child(hint)));
    const pending = details?.pending?.count ?? 0;
    return v_flex().gap(14).p(16).rounded(10).border_1().border_color(t.border).bg(t.surface)
      .child(h_flex().items_center().child(div().flex_1().text_size(14).font_semibold().child("Finish your review"))
        .when(pending > 0, (el) => el.child(div().text_size(12).text_color(t.dim).child(`${pending} pending comment${pending === 1 ? "" : "s"}`))))
      .child(this.input(t, this.reviewBody, 4, "review"))
      .child(v_flex().gap(4).children(kinds.map(option)))
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().text_size(11.5).text_color(t.blocked).child(this.postError?.where === "review" ? this.postError.text : ""))
        .child(div().id("review-cancel").px(12).py(5).rounded(7).text_size(12.5).text_color(t.muted).border_1().border_color(t.border).cursor_pointer().hover((st) => st.bg(t.hover))
          .on_click((_e, cx) => { this.finishing = false; cx.notify(); }).child("Cancel"))
        .child(this.sendButton(t, "review-submit", "Submit review", busy, (_e, cx) => this.submitReview(pr, details, pick, cx))));
  }

  submitReview(pr, details, event, cx) {
    const body = this.reviewBody.value().trim();
    this.posting = "review";
    this.postError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        if (details?.pending?.id) await this.gql("mutation($r: ID!, $e: PullRequestReviewEvent!, $b: String) { submitPullRequestReview(input: { pullRequestReviewId: $r, event: $e, body: $b }) { pullRequestReview { id } } }", { r: details.pending.id, e: event, b: body });
        else {
          if (!details?.prId) throw new Error("The pull request is still loading.");
          await this.gql("mutation($p: ID!, $c: GitObjectID!, $e: PullRequestReviewEvent!, $b: String) { addPullRequestReview(input: { pullRequestId: $p, commitOID: $c, event: $e, body: $b }) { pullRequestReview { id } } }", { p: details.prId, c: pr.headRefOid, e: event, b: body });
        }
        const reason = { APPROVE: "approved", REQUEST_CHANGES: "changes requested", COMMENT: "commented" }[event];
        if (event === "APPROVE") setShared("reviews.settled", { ...settledReviews(), [pr.url]: { pr, reason, at: Date.now() } });
        this.reviewBody.set_value("");
        this.previews?.delete("review");
        this.finishing = false;
        this.reviewEvent = null;
        this.reload(pr);
      } catch (error) {
        this.postError = { where: "review", text: error.message };
      }
      this.posting = null;
      cx.notify();
    });
  }

  activity(t, details) {
    const heading = (text) => div().text_size(11).font_semibold().text_color(t.muted).child(text.toUpperCase());
    if (!details || details.loading) return div();
    if (!details.loadedComments) return v_flex().gap(8).child(heading("Activity")).child(div().text_size(12.5).text_color(t.dim).child("Could not load the activity."));
    const list = details.activity ?? [];
    const open = localStorage.getItem("activity.open") !== "0";
    this.openBodies ??= new Set();
    const label = { APPROVED: "approved", CHANGES_REQUESTED: "requested changes", COMMENTED: "commented" };
    const color = (e) => e.state === "APPROVED" ? t.done : e.state === "CHANGES_REQUESTED" ? t.blocked : t.muted;
    const what = (e) => e.type === "review" ? `${label[e.state] ?? "reviewed"}${e.inline ? ` · ${e.inline} inline comment${e.inline === 1 ? "" : "s"}` : ""}` : "commented";
    const body = (e) => {
      const text = plainBody(e.body);
      if (!text) return null;
      const long = text.length > 700 && !this.openBodies.has(e.id);
      return v_flex().gap(4)
        .child(div().text_size(12.5).child(TextView.markdown(`activity-${e.id}-${long ? "short" : "full"}`, linkRefs(long ? `${text.slice(0, 700)}…` : text.slice(0, 8000), this.repo)).selectable(true)))
        .when(text.length > 700, (el) => el.child(div().id(`activity-more-${e.id}`).text_size(11.5).text_color(t.accent).cursor_pointer()
          .on_click((_e, cx) => { if (this.openBodies.has(e.id)) this.openBodies.delete(e.id); else this.openBodies.add(e.id); cx.notify(); })
          .child(long ? "Show all" : "Show less")));
    };
    const row = (e, i) => {
      const text = body(e);
      const last = i === list.length - 1;
      return h_flex().gap(12).items_start()
        .child(v_flex().w(11).flex_none().h_full().items_center()
          .child(div().mt(4).size(11).flex_none().rounded(6).bg(color(e)))
          .when(!last, (el) => el.child(div().w(1).flex_1().mt(4).bg(t.border))))
        .child(v_flex().flex_1().min_w(0).gap(8).pb(last ? 0 : 18)
          .child(h_flex().gap(6).items_center().text_size(12.5)
            .child(div().flex_none().font_semibold().text_color(t.foreground).child(e.actor))
            .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(what(e)))
            .child(div().flex_none().text_size(11.5).text_color(t.dim).child(`${ago(e.at)} ago`)))
          .when(Boolean(text), (el) => el.child(div().px(14).py(10).rounded(8).border_1().border_color(t.border).bg(t.surface).child(text)))
          .when(Boolean(text), (el) => el.child(this.reactionsRow(t, e.id, e.reactions, this.commentActions(t, e)))));
    };
    return v_flex().gap(12)
      .child(v_flex().pb(8).child(this.commentBox(t)))
      .child(h_flex().id("activity-toggle").gap(6).items_center().cursor_pointer()
        .on_click((_e, cx) => { localStorage.setItem("activity.open", open ? "0" : "1"); cx.notify(); })
        .child(div().text_size(11).text_color(t.dim).child(open ? "▾" : "▸"))
        .child(heading(list.length ? `Activity (${list.length})` : "Activity")))
      .when(open && list.length === 0, (el) => el.child(div().text_size(12.5).text_color(t.dim).child("Nothing yet.")))
      .when(open && list.length > 0, (el) => el.child(v_flex().children(list.map(row))));
  }

  tabs(t, pr, cx) {
    const tab = (id, text, count = null, icon = null) => {
      const on = (this.tab ?? "description") === id;
      return div().id(`tab-${id}`).px(2).pb(8).text_size(13).cursor_pointer().border_b_2()
        .border_color(on ? t.accent : t.background).text_color(on ? t.foreground : t.dim)
        .hover((st) => st.text_color(t.foreground))
        .on_click((_e, cx) => { this.tab = id; localStorage.setItem("tab", id); cx.notify(); })
        .child(h_flex().gap(6).items_center().when(Boolean(icon), (el) => el.child(svg(ICON(icon ?? "")).size(13).flex_none())).child(text).when(count != null, (el) => el.child(div().px(7).rounded(9).bg(t.raised).text_size(11.5).font_medium().text_color(t.muted).child(String(count)))));
    };
    return h_flex().gap(20).border_b_1().border_color(t.border).child(tab("description", "Overview", null, "overview")).child(tab("files", "Files changed", pr.changedFiles || null, "files")).child(tab("checks", "Checks", this.checkCount(pr), "checks"));
  }

  async viewedStates(pr) {
    const [owner, name] = pr.repo.split("/");
    const states = {};
    let id = null;
    let after = null;
    for (let page = 0; page < 30; page++) {
      const query = "query($o: String!, $n: String!, $num: Int!, $a: String) { repository(owner: $o, name: $n) { pullRequest(number: $num) { id files(first: 100, after: $a) { pageInfo { hasNextPage endCursor } nodes { path viewerViewedState } } } } }";
      const r = await exec("gh", ["api", "graphql", "-f", `query=${query}`, "-f", `o=${owner}`, "-f", `n=${name}`, "-F", `num=${pr.number}`, ...(after ? ["-f", `a=${after}`] : [])]).catch(() => null);
      if (r?.code !== 0) break;
      const node = JSON.parse(r.stdout).data?.repository?.pullRequest;
      id = node?.id ?? id;
      for (const f of node?.files?.nodes ?? []) states[f.path] = f.viewerViewedState;
      if (!node?.files?.pageInfo?.hasNextPage) break;
      after = node.files.pageInfo.endCursor;
    }
    return { id, states };
  }

  toggleViewed(file, details, cx) {
    if (!details.prId) return;
    const on = !file.viewed;
    file.viewed = on;
    if (on) this.toggled.delete(file.filename);
    cx.notify();
    const field = on ? "markFileAsViewed" : "unmarkFileAsViewed";
    cx.spawn(async (cx) => {
      const r = await exec("gh", ["api", "graphql", "-f", `query=mutation($p: ID!, $f: String!) { ${field}(input: { pullRequestId: $p, path: $f }) { clientMutationId } }`, "-f", `p=${details.prId}`, "-f", `f=${file.filename}`]).catch(() => null);
      if (r?.code !== 0) { file.viewed = !on; cx.notify(); }
    });
  }

  layoutSwitch(t) {
    const layout = conf().reviewsDiffLayout ?? "split";
    const option = (id, label) => div().id(`layout-${id}`).px(10).py(4).rounded(6).text_size(12).cursor_pointer()
      .when(layout === id, (el) => el.bg(t.raised).text_color(t.foreground)).when(layout !== id, (el) => el.text_color(t.dim).hover((st) => st.text_color(t.foreground)))
      .on_click((_e, cx) => { setShared("firehouse.settings", { ...(shared("firehouse.settings") ?? {}), reviewsDiffLayout: id }); cx.notify(); })
      .child(label);
    return h_flex().p(2).gap(2).rounded(8).border_1().border_color(t.border).child(option("unified", "Unified")).child(option("split", "Split"));
  }

  filesSection(t, pr, details) {
    const heading = (text) => div().text_size(11).font_semibold().text_color(t.muted).child(text.toUpperCase());
    if (!details || details.loading) return v_flex().gap(8).child(heading(`Files (${pr.changedFiles})`)).child(div().text_size(12.5).text_color(t.dim).child("Loading files…"));
    if (details.error) return v_flex().gap(8).child(heading(`Files (${pr.changedFiles})`)).child(div().text_size(12.5).text_color(t.blocked).child(details.error));
    const mine = details.files.filter((file) => file.mine);
    const unresolved = details.files.filter((file) => (file.threads ?? []).some((th) => !th.resolved));
    const filter = this.fileFilter ?? (details.hasRules ? "mine" : "all");
    const files = filter === "mine" ? mine : filter === "unresolved" ? unresolved : details.files;
    const hint = !details.hasRules && filter === "all" ? "This repo has no CODEOWNERS, so all files show." : files.length ? null
      : filter === "mine" ? "None of these files belong to you or your teams." : filter === "unresolved" ? "No unresolved comments." : null;
    const fileRow = (file) => {
      const byDefault = !file.viewed && (filter === "unresolved" || file.mine || (!details.hasRules && details.files.length <= 20));
      const open = byDefault !== this.toggled.has(file.filename);
      return v_flex()
        .child(h_flex().id(`file-${file.filename}`).px(12).py(6).gap(8).items_center().text_size(12).cursor_pointer().hover((st) => st.bg(t.hover))
          .on_click((_e, cx) => { if (this.toggled.has(file.filename)) this.toggled.delete(file.filename); else this.toggled.add(file.filename); cx.notify(); })
          .child(div().flex_none().text_color(t.dim).child(open ? "▾" : "▸"))
          .child(div().flex_1().min_w(0).truncate().text_color(file.viewed ? t.dim : file.mine ? t.foreground : t.muted).child(file.filename))
          .when((file.threads ?? []).some((th) => !th.resolved), (el) => el.child(div().flex_none().px(6).rounded(8).bg(t.raised).text_size(11).text_color(t.accent).tooltip("Open comment threads").child(`💬 ${file.threads.filter((th) => !th.resolved).length}`)))
          .when((file.threads ?? []).length > 0 && (file.threads ?? []).every((th) => th.resolved), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).tooltip("All threads resolved").child(`💬 ${file.threads.length} ✓`)))
          .when(filter !== "mine" && details.hasRules && file.mine, (el) => el.child(div().flex_none().px(5).rounded(4).bg(t.raised).text_size(10.5).text_color(t.accent).child("yours")))
          .child(div().flex_none().text_color(t.done).child(`+${file.additions}`))
          .child(div().flex_none().text_color(t.blocked).child(`−${file.deletions}`))
          .child(h_flex().id(`viewed-${file.filename}`).flex_none().gap(5).items_center().px(7).py(1).rounded(6).text_size(11.5).border_1()
            .border_color(file.viewed ? t.done : t.border).text_color(file.viewed ? t.done : t.dim).cursor_pointer().hover((st) => st.bg(t.hover))
            .tooltip(file.viewed ? "Mark as not viewed" : "Mark as viewed. It also shows as viewed on GitHub.")
            .on_click((_e, cx) => { cx.stop_propagation(); this.toggleViewed(file, details, cx); })
            .child(div().size(10).flex_none().rounded(2).border_1().border_color(file.viewed ? t.done : t.dim).when(file.viewed, (el) => el.bg(t.done)))
            .child("Viewed")))
        .when(open, (el) => el.child(this.diff(t, file)));
    };
    const chip = (id, label, count) => {
      const on = filter === id;
      return h_flex().id(`filter-${id}`).px(10).py(4).gap(6).items_center().rounded(7).text_size(12.5).cursor_pointer()
        .when(on, (el) => el.bg(t.selected).text_color(t.foreground)).when(!on, (el) => el.text_color(t.muted).hover((st) => st.bg(t.hover).text_color(t.foreground)))
        .on_click((_e, cx) => { this.fileFilter = id; this.toggled = new Set(); cx.notify(); })
        .child(label)
        .child(div().px(6).rounded(8).bg(t.raised).text_size(11).text_color(t.muted).child(String(count)));
    };
    return v_flex().gap(10)
      .child(h_flex().gap(4).items_center()
        .when(details.hasRules, (el) => el.child(chip("mine", "Yours", mine.length)))
        .child(chip("all", "All", details.files.length))
        .child(chip("unresolved", "Unresolved comments", unresolved.length))
        .child(div().flex_1())
        .child(div().flex_none().text_size(12).text_color(t.dim).child(`${files.filter((f) => f.viewed).length} of ${files.length} viewed`))
        .child(this.layoutSwitch(t)))
      .when(Boolean(hint), (el) => el.child(div().text_size(12).text_color(t.dim).child(hint ?? "")))
      .when(files.length > 0, (el) => el.child(v_flex().rounded(10).border_1().border_color(t.border).overflow_hidden().children(files.map(fileRow))));
  }

  button(t, id, icon, label, onClick) {
    return h_flex().id(id).flex_none().h(28).px(10).gap(6).items_center().rounded(7).text_size(12.5).cursor_pointer()
      .bg(t.raised).border_1().border_color(t.border).hover((st) => st.bg(t.hover))
      .on_click((_e, cx) => { onClick(); cx.notify(); })
      .child(svg(ICON(icon)).size(13)).child(label);
  }

  detail(t, pr, cx) {
    if (!pr) return v_flex().flex_1().items_center().justify_center().gap(6).text_color(t.dim).text_size(13)
      .child(svg(ICON("pr-open")).size(22)).child("Pick a pull request on the left.");
    const body = dropEmptySections(plainBody(pr.body));
    this.repo = pr.repo;
    this.pr = pr;
    const details = this.load(pr, cx);
    return v_flex().id("review-detail").flex_1().min_w(0).h_full().overflow_y_scroll().px(28).py(22).gap(18)
      .child(v_flex().gap(8)
        .child(h_flex().gap(10).items_center()
          .when(pr.ci === "SUCCESS", (el) => el.child(svg(ICON("check")).size(16).flex_none().text_color(t.done).tooltip("CI passed")))
          .when(pr.ci === "FAILURE" || pr.ci === "ERROR", (el) => el.child(svg(ICON("x")).size(16).flex_none().text_color(t.blocked).tooltip("CI failing")))
          .when(pr.ci === "PENDING" || pr.ci === "EXPECTED", (el) => el.child(div().size(9).mx(3).flex_none().rounded(5).bg(t.working).loop("opacity", { from: 0.35, to: 1, period: 1200 }).tooltip("CI running")))
          .child(div().flex_1().min_w(0).text_size(17).font_semibold().child(pr.title))
          .child(this.checkoutButton(t, pr))
          .child(this.reviewButton(t, pr, this.load(pr, cx))))
        .child(h_flex().gap(8).items_center().text_size(12.5).text_color(t.dim)
          .child(div().child(`${pr.authorName ?? pr.author} opened ${ago(pr.createdAt)} ago`))
          .child(div().child("·"))
          .child(div().text_color(t.done).child(`+${pr.additions ?? 0}`))
          .child(div().text_color(t.blocked).child(`−${pr.deletions ?? 0}`))))
      .when(Boolean(this.finishing), (el) => el.child(this.finishPanel(t, pr, this.load(pr, cx))))
      .child(this.tabs(t, pr, cx))
      .child(this.tab === "checks" ? this.checksTab(t, this.load(pr, cx)) : this.tab !== "files"
        ? v_flex().gap(28)
          .child(this.statusBar(t, pr, details, cx))
          .child(v_flex()
            .child(div().px(18).py(14).rounded(10).border_1().border_color(t.border).bg(t.surface).text_size(12.5).text_color(body ? t.foreground : t.dim)
              .child(body ? TextView.markdown(`review-body-${pr.number}`, linkRefs(body.slice(0, 20000), pr.repo)).selectable(true) : "No description.")))
          .child(this.activity(t, details))
        : this.filesSection(t, pr, details));
  }

  render(cx) {
    if (props()?.watch) return div();
    if (props()?.menu) return this.renderMenu();
    if (!props()?.view) return this.renderList();
    const t = theme();
    const pr = findPr(shared("reviews.selected")) ?? items()[0] ?? null;
    if (pr?.url !== this.shown) { this.shown = pr?.url ?? null; this.toggled = new Set(); this.fileFilter = null; }
    return h_flex().size_full().min_h(0).bg(t.background).text_color(t.foreground).child(this.detail(t, pr, cx));
  }
}
