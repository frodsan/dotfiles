---
name: dev-cleanup
description: Free disk space on this laptop by removing git worktrees and branches with no Claude session in every repo under ~/Code, per-branch Postgres databases, unused Podman volumes and images, unused asdf Ruby versions and Rust build folders, then compacting the Podman disk file. Use when the user asks to clean up, free disk space, or says Podman or worktrees take too much space.
disable-model-invocation: true
---

# Dev cleanup

The scripts are in `scripts/`, next to this file. Repos live at `~/Code/<group>/<repo>`, and their Worktrunk worktrees sit next to them as `<repo>.<branch>`.

Each step finds candidates, then asks before deleting. Ask once per step with the full list and sizes, not once per item. Deleting is the user's call; never delete something they did not approve.

## 1. Measure

Record the starting point so the final report can show what was freed:

- `df -h /Users`
- `du -sh ~/.local/share/containers/podman/machine/libkrun/*.raw`
- `podman machine ssh df -h /var`
- `podman system df`

## 2. Worktrees and branches

Run `ruby scripts/audit_git.rb`. It scans every main checkout under `~/Code/*/*`, or only the repo paths passed as arguments. It prints JSON with `session_dirs`, the working directories of running `claude` processes, and one entry per repo. Repos with nothing to clean show `"nothing to clean"`. The others have:

- `kept_worktrees`: the main checkout, and every worktree a session runs in. Their branches and the default branch are kept.
- `worktrees_to_remove`: each with `missing` (the folder is gone), `changed_files` and `untracked_files`.
- `stale_folders`: `<repo>.*` folders that are not worktrees, for example the rest of a removal that did not finish.
- `branches.pushed`: every commit is on a remote. Safe to delete.
- `branches.merged`: the pull request is merged, so the local commits were squash-merged. Safe to delete.
- `branches.needs_decision`: a closed pull request, no pull request (`NONE`) or a remote that is not on GitHub (`UNKNOWN`), with commits on no remote.

Show a table per repo, then, after the user approves:

1. Remove existing worktrees with `wt -C <repo> remove --no-delete-branch --foreground --yes <branches...>`. It runs the repo's `pre-remove` and the user's `post-remove` hooks, which may drop the branch databases. Leave out any worktree with changed or untracked files unless the user approves losing them.
2. Run `git -C <repo> worktree prune -v` for the missing ones.
3. Delete `pushed` and `merged` branches with `git -C <repo> branch -D`.
4. Before deleting any `needs_decision` branch, append `<sha> <branch>` lines to `~/deleted-branches-<repo>-<date>.txt` with `git -C <repo> for-each-ref --format='%(objectname) %(refname:short)'`, and tell the user the file path.
5. `stale_folders` need `rm -rf`, which the permission classifier blocks. Give the user the `! rm -rf ...` command.

## 3. Per-branch databases

Run `ruby scripts/orphan_databases.rb`. Some apps give each branch its own Postgres databases, named `<database>__<branch>` with the branch lowercased, every other character turned into `_`, and the name cut at 63 characters. The script lists those whose branch has no worktree in any repo under `~/Code`. Drop them with `dropdb --if-exists --force <name>`. Never drop a name without `__`: those are the shared databases every branch is copied from.

## 4. Podman

- `podman system df -v`: volumes with 0 links and images no container uses. Offer `podman volume prune -f` and `podman image prune -a -f`. Name the large volumes, since a volume of another project may hold data the user wants.
- Inactive replication slots keep WAL forever:
  `psql -X -d postgres -c "SELECT slot_name, active, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) FROM pg_replication_slots"`.
  Offer `SELECT pg_drop_replication_slot('<name>')` then `CHECKPOINT` for the inactive ones.
- A container created from a removed worktree fails to start with `cannot stat .../<repo>.<branch>/...`. Recreate it from the main checkout with `podman compose -f docker-compose.yaml up -d --force-recreate --no-deps <service>`. The data volume is kept.

## 5. Ruby versions and Rust builds

- `asdf list ruby`, then `grep -s '^ruby ' ~/.tool-versions ~/Code/*/.tool-versions ~/Code/*/*/.tool-versions`. Offer `asdf uninstall ruby <version>` for versions no file pins. Each version holds its own gems.
- Rust `target` folders: `du -sh ~/Code/*/*/target`. Offer `cargo clean --manifest-path <project>/Cargo.toml`. Never run `cargo clippy` on this laptop.

## 6. Compact the Podman disk

The VM never returns freed space to macOS: libkrun has no discard support, so `fstrim` fails. Compare the `.raw` size with the space used inside the VM. When the gap is more than about 10 GB, ask the user to run, as a single input:

```
! ruby ~/.claude/skills/dev-cleanup/scripts/compact_podman_disk.rb
```

The permission classifier blocks this script for you, so the user must run it. It stops the containers, zeroes the free space, writes a sparse copy with `/bin/dd` (GNU `dd` is first in `PATH` and rejects `bs=1m`), keeps `backup.raw` and restarts the containers. Afterwards, check that Postgres answers and that the databases are there, then tell the user to delete `backup.raw`.

## 7. Report

Show the same measurements as in step 1, before and after, and list anything left for the user to run.
