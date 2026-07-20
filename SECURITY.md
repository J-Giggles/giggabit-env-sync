# Security — publishing this package

This directory contains **only source** (Node ESM). It does **not** embed API keys or deployment secrets.

## Before you commit or push to a public repo

1. **Scope the diff** — from the monorepo root, only add this prefix:
   ```bash
   git add scripts/giggabit-env-sync/
   git diff --cached --stat
   ```
2. **Confirm no env files** — these must **not** appear in `git status` / the commit:
   - `.env`, `.env.local`, `.env.*.local`, `.env.sync.*`, `.env/sync/`, `.env.sync-cache/`
   - Any file produced by `vercel env pull` / `convex env list` (sorted dumps, caches).
3. **Quick pattern scan** (optional):
   ```bash
   rg -n 'sk_live_|sk_test_|ghp_|github_pat_|xox[baprs]-|BEGIN (RSA |OPENSSH )?PRIVATE KEY' scripts/giggabit-env-sync/
   ```
   Expect **no** matches in tracked source (README may mention words like “token” in prose only).
4. **Subtree push** (from app repo root) — pushes **only** this folder’s tree to the standalone remote; still verify step 1–2 after `git add`.

### Upstream repo diverged (push rejected)

If `git subtree push --prefix=scripts/giggabit-env-sync <remote> master` fails with **fetch first** / non–fast-forward, merge the public repo into this prefix, then push again (working tree must be clean):

```bash
git stash -u   # if needed
git subtree pull --prefix=scripts/giggabit-env-sync <remote> master -m "chore: merge upstream giggabit-env-sync"
# resolve any conflicts under scripts/giggabit-env-sync/
git subtree push --prefix=scripts/giggabit-env-sync <remote> master
git stash pop  # if you stashed
```

Replace `<remote>` with your remote name (e.g. `giggabit-env-sync`). Use **`main`** instead of **`master`** if the upstream default branch is `main`.

## What the tool writes locally (never commit)

| Output | Typical location (app repo) |
|--------|-----------------------------|
| Merged snapshots | `.env.sync.merge.*` |
| `pull --all` | `.env.sync.development`, etc. |
| Vercel CLI cache | `<cache-dir>/cache.vercel.*` |
| Convex push temp | `<cache-dir>/push.convex.*` |
| Metadata / backups | `<cache-dir>/` |

`<cache-dir>` is `.env/sync/`, or `.env.sync-cache/` when root `.env` is a file. Parent app `.gitignore` should ignore `.env*` / `.env.sync.*` / `.env/sync/` / `.env.sync-cache/` (see README).
