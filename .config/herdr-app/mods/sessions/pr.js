// The pull request of the shown session, ported from Firehouse's PR bar: state and
// review, CI checks (investigate, fix, re-run), unresolved review comments (ask
// Claude, address, resolve), ready for review, auto-merge, conflicts. Claude actions
// type into the session's Claude tab, or open one on its conversation.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, exec, hc, run, theme, shared, setShared, notify, home, window } from "herdr";

const ICON = (name) => `mods/sessions/${name}.svg`;
const REFRESH_MS = 60000;
const MEMBER = ["OWNER", "MEMBER", "COLLABORATOR"];
const COMMENT_PREVIEW = 400;

const THREADS = `query($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { reviewThreads(first: 100) { nodes {
    id isResolved path line
    comments(first: 1) { totalCount nodes { id body url authorAssociation createdAt author { login } } }
  } } } }
}`;

function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((t) => t.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || home();
}

function ago(iso) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  return d < 3600 ? `${Math.max(1, Math.round(d / 60))}m` : d < 86400 ? `${Math.round(d / 3600)}h` : `${Math.round(d / 86400)}d`;
}

async function gh(args, cwd) {
  const r = await exec("gh", args, { cwd });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || "gh failed");
  return r.stdout;
}

function checkState(e) {
  if (e.__typename === "StatusContext") return e.state === "SUCCESS" ? "passed" : e.state === "PENDING" || e.state === "EXPECTED" ? "running" : "failed";
  if (e.status !== "COMPLETED") return "running";
  if (e.conclusion === "SUCCESS" || e.conclusion === "NEUTRAL") return "passed";
  if (["SKIPPED", "CANCELLED", "STALE"].includes(e.conclusion)) return "skipped";
  return "failed";
}

function toChecks(rollup) {
  const latest = new Map();
  for (const e of rollup ?? []) {
    const key = e.__typename === "StatusContext" ? `status:${e.context}` : `${e.workflowName ?? ""}:${e.name}`;
    const current = latest.get(key);
    if (!current || (e.startedAt ?? "") >= (current.startedAt ?? "")) latest.set(key, e);
  }
  return [...latest.values()].map((e) => ({ name: e.name ?? e.context ?? "Check", workflow: e.workflowName || null, state: checkState(e), url: e.detailsUrl ?? e.targetUrl ?? null }));
}

async function fetchStatus(cwd) {
  let view;
  try {
    view = JSON.parse(await gh(["pr", "view", "--json", "number,url,title,state,isDraft,reviewDecision,mergeable,baseRefName,headRefName,autoMergeRequest,statusCheckRollup"], cwd));
  } catch (e) {
    if (/no pull requests found/i.test(e.message)) return null;
    throw e;
  }
  const [, owner, name, number] = view.url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/) ?? [];
  let comments = [];
  try {
    const data = JSON.parse(await gh(["api", "graphql", "-f", `query=${THREADS}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${number}`], cwd)).data;
    comments = data.repository.pullRequest.reviewThreads.nodes.flatMap((thread) => {
      const first = thread.comments.nodes[0];
      if (thread.isResolved || !first) return [];
      return [{ id: first.id, threadId: thread.id, author: first.author?.login ?? "ghost", member: MEMBER.includes(first.authorAssociation) && first.author?.login !== data.viewer.login, path: thread.path, line: thread.line, body: first.body, url: first.url, createdAt: first.createdAt, replies: Math.max(thread.comments.totalCount - 1, 0) }];
    }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  } catch {}
  return { ...view, autoMerge: Boolean(view.autoMergeRequest), checks: toChecks(view.statusCheckRollup), comments, fetchedAt: Date.now() };
}

const checkLine = (c) => `- ${c.workflow ? `${c.workflow} / ` : ""}${c.name}${c.url ? ` (${c.url})` : ""}`;
const runIds = (c) => c.url?.match(/\/actions\/runs\/(\d+)(?:\/job\/(\d+))?/);
const commentLines = (comments) => comments.flatMap((c) => [`- @${c.author}${c.path ? ` on ${c.path}${c.line ? `:${c.line}` : ""}` : ""} (${c.url}):`, ...c.body.split("\n").map((l) => `  > ${l}`)]);

const PROMPTS = {
  investigate: (s, checks) => checks.length === 1
    ? `The check "${checks[0].workflow ? `${checks[0].workflow} / ` : ""}${checks[0].name}" failed on pull request #${s.number} (${s.url}).\nRead its logs with ${runIds(checks[0])?.[2] ? `\`gh run view --job ${runIds(checks[0])[2]} --log-failed\`` : "`gh pr checks` and the check link"}. Explain the root cause, whether this branch caused it or it looks flaky, and what you would change. Do not change any files yet.`
    : [`These checks failed on pull request #${s.number} (${s.url}):`, ...checks.map(checkLine), "", "Read their logs with `gh run view --job <job-id> --log-failed`. For each one, explain the root cause and whether this branch caused it or it looks flaky. Do not change any files yet."].join("\n"),
  fix: (s, checks) => [`CI is failing on pull request #${s.number} (${s.url}). ${checks.length === 1 ? "Fix only this check, leave the others for later:" : "These checks failed:"}`, ...checks.map(checkLine), "", "Read the logs with `gh pr checks` and `gh run view <run-id> --log-failed`. Find the root cause, fix it, run the relevant tests locally, then commit and push.", "If a failure is flaky or unrelated to this branch, say so instead of changing code."].join("\n"),
  address: (s, comments) => [`Address these review comments on pull request #${s.number} (${s.url}):`, ...commentLines(comments), "", "Make the changes, run the relevant tests, then commit and push. Reply on each thread with `gh` to say what you changed. If you disagree with a comment, explain why instead of changing the code."].join("\n"),
  opinion: (s, comments) => [`Give me your opinion on these review comments on pull request #${s.number} (${s.url}):`, ...commentLines(comments), "", "For each one, say whether you agree and what you would change. Do not change any files yet."].join("\n"),
  updateBase: (s) => [`Update pull request #${s.number} (${s.url}) with the latest ${s.baseRefName}.`, `Fetch origin and merge origin/${s.baseRefName} into ${s.headRefName}. Do not rebase or force-push.`, "If there are conflicts, resolve them and keep the intent of both sides, then run the tests for the files you touched.", "Push the merge commit. If the branch is already up to date, say so and do nothing."].join("\n"),
};

export class PullRequestPanel {
  init(_props, cx) {
    this.cache = shared("pr.cache") ?? {};
    this.loading = new Set();
    this.error = {};
    this.showPassed = false;
    this.expanded = new Set();
    this.busy = null;
    this.lastSpace = null;
    cx.timer.every(1000, (cx) => this.tick(cx));
    cx.timer.every(REFRESH_MS, (cx) => { if (window().active) this.refresh(cx, true); });
  }

  current() {
    const s = spaces().find((space) => space.active);
    if (!s) return null;
    const ps = panes();
    const path = shared("sessions.repoOf")?.[s.id] ?? place(s, ps);
    return { s, path, cwd: place(s, ps) };
  }

  tick(cx) {
    const c = this.current();
    if (!c) return;
    if (c.s.id !== this.lastSpace) {
      this.lastSpace = c.s.id;
      this.refresh(cx, !this.cache[c.path] || Date.now() - this.cache[c.path].fetchedAt > 15000);
      this.publish();
    }
  }

  publish() {
    const c = this.current();
    const status = c ? this.cache[c.path]?.status : null;
    const failing = status?.checks.some((k) => k.state === "failed");
    const running = status?.checks.some((k) => k.state === "running");
    const badge = status ? { space: c.s.id, number: status.number, ci: status.checks.length ? (failing ? "failed" : running ? "running" : "passed") : null } : null;
    if (JSON.stringify(badge) !== JSON.stringify(shared("pr.badge") ?? null)) setShared("pr.badge", badge);
  }

  refresh(cx, force = false) {
    const c = this.current();
    if (!c || this.loading.has(c.path) || (!force && this.cache[c.path])) return;
    const { path } = c;
    this.loading.add(path);
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const status = await fetchStatus(path);
        this.cache[path] = { status, fetchedAt: Date.now() };
        delete this.error[path];
        const kept = Object.fromEntries(Object.entries(this.cache).sort((a, b) => b[1].fetchedAt - a[1].fetchedAt).slice(0, 40));
        setShared("pr.cache", kept);
      } catch (e) {
        this.error[path] = e.message;
      }
      this.loading.delete(path);
      this.publish();
      cx.notify();
    });
  }

  send(text) {
    const c = this.current();
    if (!c) return;
    const tabs = new Set(c.s.tabs.map((t) => t.id));
    const claude = panes().find((p) => tabs.has(p.tab) && p.terminal && (p.program?.key === "claude" || /claude/i.test(p.app ?? "")));
    if (claude) {
      hc(["send", claude.terminal, text]).then((r) => {
        if (r.code !== 0) notify({ title: "Could not send to Claude", body: (r.stderr || r.stdout).trim(), level: "error" });
      });
      run("tab.select", { id: claude.tab });
      notify({ title: "Sent to Claude", body: text.split("\n")[0], level: "success", timeout: 3000 });
      return;
    }
    const id = shared("sessions.claude")?.[c.s.id];
    run("tab.new", { space: c.s.id, folder: c.cwd, argv: id ? ["claude", "--resume", id] : ["claude"], task: text });
  }

  act(label, work, cx) {
    const c = this.current();
    this.busy = label;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await work(c.path);
      } catch (e) {
        notify({ title: `${label} failed`, body: e.message, level: "error" });
      }
      this.busy = null;
      this.refresh(cx, true);
      cx.notify();
    });
  }

  button(id, label, onClick, t, primary = false, disabled = false) {
    return h_flex().id(id).h(26).px(10).gap(5).flex_none().items_center().rounded(6).text_size(12)
      .when(primary, (el) => el.bg(t.solid).text_color(t.solid_foreground))
      .when(!primary, (el) => el.border_1().border_color(t.input).text_color(t.foreground))
      .when(disabled, (el) => el.opacity(0.5))
      .when(!disabled, (el) => el.cursor_pointer().hover((s) => (primary ? s.opacity(0.88) : s.bg(t.hover))).on_click(onClick))
      .child(label);
  }

  small(id, label, onClick, t) {
    return div().id(id).px(6).py(2).rounded(5).text_size(11.5).text_color(t.accent).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); }).child(label);
  }

  heading(text, t, right, toggle) {
    const label = div().flex_1().text_size(11).font_medium().text_color(t.dim).child(text.toUpperCase());
    return h_flex().pt(16).pb(6).items_center()
      .child(toggle
        ? h_flex().id(toggle.id).flex_1().gap(6).items_center().cursor_pointer().hover((st) => st.text_color(t.foreground))
          .on_click((_e, cx) => { toggle.onClick(); cx.notify(); })
          .child(div().text_size(11).text_color(t.dim).child(toggle.open ? "▾" : "▸")).child(label)
        : label)
      .when(Boolean(right), (el) => el.child(right));
  }

  render() {
    const t = theme();
    const c = this.current();
    const frame = (child) => v_flex().size_full().min_h(0).bg(t.chrome).child(
      h_flex().h(38).px(14).flex_none().items_center().border_b_1().border_color(t.border).gap(8)
        .child(svg(ICON("pr-open")).size(14).text_color(t.dim))
        .child(div().flex_1().text_size(12.5).font_medium().text_color(t.foreground).child("Pull request"))
        .when(Boolean(c && this.loading.has(c.path)), (el) => el.child(svg("mods/sessions/spinner.svg").size(12).spin(900).text_color(t.dim)))
        .child(div().id("pr-refresh").p(4).rounded(5).text_size(11.5).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).tooltip("Refresh")
          .on_click((_e, cx) => this.refresh(cx, true)).child("↻")),
    ).child(v_flex().id("pr-body").flex_1().min_h(0).px(14).pb(18).overflow_y_scrollbar().child(child));
    if (!c) return frame(div().pt(14).text_size(12.5).text_color(t.dim).child("No session."));
    const entry = this.cache[c.path];
    if (this.error[c.path] && !entry) return frame(div().pt(14).text_size(12.5).text_color(t.blocked).child(this.error[c.path]));
    if (!entry) return frame(div().pt(14).text_size(12.5).text_color(t.dim).child("Loading…"));
    const s = entry.status;
    if (!s) return frame(div().pt(14).text_size(12.5).text_color(t.dim).child("This session has no pull request yet."));
    const open = s.state === "OPEN";
    const state = s.isDraft ? "draft" : { OPEN: "open", MERGED: "merged", CLOSED: "closed" }[s.state];
    const stateColor = { open: t.done, draft: t.dim, merged: t.ansi5, closed: t.ansi1 }[state];
    const review = !open || s.isDraft ? null : s.reviewDecision === "APPROVED" ? ["Approved", t.done] : s.reviewDecision === "CHANGES_REQUESTED" ? ["Changes requested", t.ansi1] : ["Review required", t.dim];
    const failing = s.checks.filter((k) => k.state === "failed");
    const running = s.checks.filter((k) => k.state === "running");
    const passed = s.checks.filter((k) => k.state === "passed" || k.state === "skipped");
    const checksOpen = localStorage.getItem("checks.open") === "1";
    const checkRow = (k, i) => h_flex().id(`check-${i}`).py(4).gap(8).items_center().text_size(12)
      .child(div().size(7).rounded(4).flex_none().bg(k.state === "failed" ? t.ansi1 : k.state === "running" ? t.working : t.done).when(k.state === "running", (el) => el.loop("opacity", { from: 0.35, to: 1, period: 1200 })))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).cursor_pointer().on_click(() => k.url && exec("open", [k.url])).child(`${k.workflow ? `${k.workflow} / ` : ""}${k.name}`))
      .when(k.state === "failed", (el) => el
        .child(this.small(`check-why-${i}`, "Why?", () => this.send(PROMPTS.investigate(s, [k])), t))
        .child(this.small(`check-fix-${i}`, "Fix", () => this.send(PROMPTS.fix(s, [k])), t))
        .when(Boolean(runIds(k)), (el) => el.child(this.small(`check-rerun-${i}`, "Re-run", (cx) => this.act("Re-run", (path) => gh(["run", "rerun", runIds(k)[1], "--failed"], path), cx), t))));
    const comment = (k, i) => v_flex().id(`comment-${i}`).mb(8).p(10).gap(4).rounded(8).bg(t.surface).border_1().border_color(t.border)
      .child(h_flex().gap(6).items_center().text_size(11.5)
        .child(div().font_semibold().text_color(t.foreground).child(`@${k.author}`))
        .when(Boolean(k.path), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`${k.path.split("/").pop()}${k.line ? `:${k.line}` : ""}`)))
        .when(!k.path, (el) => el.child(div().flex_1()))
        .child(div().flex_none().text_color(t.dim).child(`${ago(k.createdAt)}${k.replies ? ` · ${k.replies} ${k.replies === 1 ? "reply" : "replies"}` : ""}`)))
      .child(div().text_size(12).text_color(t.muted).child(k.body.length > COMMENT_PREVIEW && !this.expanded.has(k.id) ? `${k.body.slice(0, COMMENT_PREVIEW).trimEnd()}…` : k.body))
      .when(k.body.length > COMMENT_PREVIEW, (el) => el.child(div().id(`more-${i}`).text_size(11.5).text_color(t.accent).cursor_pointer().hover((st) => st.text_color(t.foreground))
        .on_click((_e, cx) => { if (this.expanded.has(k.id)) this.expanded.delete(k.id); else this.expanded.add(k.id); cx.notify(); })
        .child(this.expanded.has(k.id) ? "Show less" : "Show more")))
      .child(h_flex().gap(2).pt(2)
        .child(this.small(`ask-${i}`, "Ask Claude", () => this.send(PROMPTS.opinion(s, [k])), t))
        .child(this.small(`address-${i}`, "Fix with Claude", () => this.send(PROMPTS.address(s, [k])), t))
        .child(this.small(`resolve-${i}`, "Mark resolved", (cx) => this.act("Mark resolved", () => gh(["api", "graphql", "-f", "query=mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { clientMutationId } }", "-f", `id=${k.threadId}`], home()), cx), t))
        .child(div().flex_1())
        .child(h_flex().id(`open-${i}`).px(6).py(2).gap(4).items_center().rounded(5).text_size(11.5).text_color(t.accent).cursor_pointer().hover((st) => st.bg(t.hover).text_color(t.foreground))
          .tooltip("Open the thread on GitHub")
          .on_click((_e, cx) => { cx.stop_propagation(); exec("open", [k.url]); })
          .child("GitHub").child(svg("mods/sessions/external-link.svg").size(11))));
    const busy = Boolean(this.busy);
    return frame(v_flex()
      .child(h_flex().pt(14).gap(6).items_center()
        .child(svg(ICON(`pr-${state}`)).size(14).flex_none().text_color(stateColor))
        .child(div().id("pr-number").text_size(12.5).text_color(t.accent).cursor_pointer().hover((st) => st.text_color(t.foreground)).on_click(() => exec("open", [s.url])).child(`#${s.number}`))
        .child(div().text_size(12).text_color(stateColor).child({ open: "Open", draft: "Draft", merged: "Merged", closed: "Closed" }[state]))
        .when(Boolean(review), (el) => el.child(div().text_size(12).text_color(review[1]).child(`· ${review[0]}`)))
        .when(s.mergeable === "CONFLICTING", (el) => el.child(div().text_size(12).text_color(t.ansi1).child("· Conflicts"))))
      .child(div().pt(6).text_size(14).font_semibold().text_color(t.foreground).child(s.title))
      .child(div().pt(4).text_size(11.5).text_color(t.dim).child(`${s.headRefName} → ${s.baseRefName}`))
      .when(open, (el) => el.child(h_flex().pt(12).gap(6).flex_wrap()
        .when(s.isDraft, (el) => el.child(this.button("pr-ready", this.busy === "Ready for review" ? "Marking ready…" : "Ready for review", (_e, cx) => this.act("Ready for review", (path) => gh(["pr", "ready", s.url], path), cx), t, true, busy)))
        .child(this.button("pr-update", s.mergeable === "CONFLICTING" ? `Resolve conflicts with ${s.baseRefName}` : `Merge ${s.baseRefName} & push`, () => this.send(PROMPTS.updateBase(s)), t, s.mergeable === "CONFLICTING"))
        .child(this.button("pr-autofix", shared("pr.autoFix")?.[c.s.id] ? "Auto-fix on ✓" : "Auto-fix", () => {
          const all = { ...(shared("pr.autoFix") ?? {}) };
          if (all[c.s.id]) delete all[c.s.id];
          else all[c.s.id] = { handled: [], rounds: 0 };
          setShared("pr.autoFix", all);
          const status = { ...(shared("pr.autoFixStatus") ?? {}) };
          delete status[c.s.id];
          setShared("pr.autoFixStatus", status);
        }, t))
        .map((el) => {
          const on = s.autoMerge || Boolean(shared("pr.mergeWhenReady")?.[c.s.id]);
          if (!on && !["main", "master"].includes(s.baseRefName)) return el;
          return el.child(this.button("pr-auto", on ? "Merge when ready ✓" : "Merge when ready", () => {
            setShared("sessions.requests", [...(shared("sessions.requests") ?? []), { kind: "automerge", entry: { id: c.s.id, cwd: c.path, machine: c.s.machine ?? null, pr: { url: s.url, autoMergeRequest: s.autoMerge ? {} : null } }, on: !on, at: Date.now() }]);
            run("sessions.requests");
          }, t, false, busy));
        })))
      .child(this.heading(`Checks${s.checks.length ? ` · ${failing.length ? `${failing.length} failing` : running.length ? `${running.length} running` : "all passed"}` : ""}`, t,
        failing.length > 1 ? h_flex().gap(2).child(this.small("checks-why", "Why?", () => this.send(PROMPTS.investigate(s, failing)), t)).child(this.small("checks-fix", "Fix all", () => this.send(PROMPTS.fix(s, failing)), t)) : null,
        s.checks.length ? { id: "checks-toggle", open: checksOpen, onClick: () => localStorage.setItem("checks.open", checksOpen ? "0" : "1") } : null))
      .when(!s.checks.length, (el) => el.child(div().text_size(12).text_color(t.dim).child("No checks.")))
      .children(checksOpen ? [...failing, ...running].map(checkRow) : [])
      .when(checksOpen && passed.length > 0, (el) => el.child(div().id("checks-passed").py(4).text_size(12).text_color(t.dim).cursor_pointer().hover((st) => st.text_color(t.foreground))
        .on_click((_e, cx) => { this.showPassed = !this.showPassed; cx.notify(); }).child(`${this.showPassed ? "▾" : "▸"} ${passed.length} passed`)))
      .when(checksOpen && this.showPassed, (el) => el.children(passed.map((k, i) => checkRow(k, `p${i}`))))
      .child(this.heading(`Comments · ${s.comments.length} unresolved`, t, s.comments.length > 1 ? h_flex().gap(2).child(this.small("comments-ask", "Ask Claude", () => this.send(PROMPTS.opinion(s, s.comments)), t)).child(this.small("comments-address", "Fix all with Claude", () => this.send(PROMPTS.address(s, s.comments)), t)) : null))
      .when(!s.comments.length, (el) => el.child(div().text_size(12).text_color(t.dim).child("No unresolved comments.")))
      .children(s.comments.map(comment))
      .child(div().pt(14).text_size(11).text_color(t.dim).child(`Updated ${ago(new Date(entry.fetchedAt).toISOString())} ago`)));
  }
}
