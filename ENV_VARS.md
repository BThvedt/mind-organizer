# Environment Variables

How secrets and configuration get into the running services for Mind Organizer, in both local dev and production.

## TL;DR

| Service | Local dev (file) | Production (file) |
|---|---|---|
| **Frontend (Next.js)** | `frontend/.env.local` | env vars set in the deployment platform (Vercel / wherever Next.js is hosted) |
| **Backend (Drupal/PHP)** | `backend/.ddev/config.local.yaml` | `/home/deploy/mind-organizer/backend/.env` on the DigitalOcean server |

All four files are gitignored. Real secrets never live in committed files.

---

## Frontend (Next.js)

### Local dev

`frontend/.env.local` is read automatically by Next.js when running `npm run dev`. Values are accessible in:

- **Server-side code** (route handlers, server components): `process.env.MY_VAR`
- **Client-side code** (browser): only vars prefixed with `NEXT_PUBLIC_` are exposed

Current vars (excerpt):

```
NEXT_PUBLIC_DRUPAL_BASE_URL=http://backend.ddev.site
DRUPAL_CLIENT_ID=local-frontend
DRUPAL_CLIENT_SECRET=...
ANTHROPIC_API_KEY=sk-ant-...
NEXT_PUBLIC_TURNSTILE_SITE_KEY=...
TURNSTILE_SECRET_KEY=...
```

This file is gitignored via `frontend/.gitignore` (`.env*` rule).

### Production

Set the same variable names in the hosting platform's environment-variable UI (Vercel project settings, or whatever Next.js host you use). They're exposed to `process.env` at runtime exactly the same way.

### Where Anthropic AI calls actually happen

Despite the existence of `backend/web/modules/custom/study_flashcard_generator/src/Service/AiFlashcardService.php` (which uses `getenv('ANTHROPIC_API_KEY')`), that PHP code is **dead** in the live UI. The real Anthropic calls go from Next.js:

- `frontend/src/app/api/notes/[id]/ai/route.ts` — note-level AI (format / add content / generate deck)
- `frontend/src/app/api/decks/[id]/generate/route.ts` — deck-level AI generation

Both read `process.env.ANTHROPIC_API_KEY` from `frontend/.env.local`.

---

## Backend (Drupal / PHP)

### Local dev — DDEV

DDEV uses a **two-file pattern**:

| File | Committed? | Purpose |
|---|---|---|
| `backend/.ddev/config.yaml` | Yes (tracked) | Documents which env vars exist (placeholder values) |
| `backend/.ddev/config.local.yaml` | No (gitignored) | Holds the real secret values |

DDEV automatically merges any `.ddev/config.*.yaml` file with `config.yaml`, with the override winning. The merged result is baked into the web container's environment at startup.

**Example `config.local.yaml`:**

```yaml
web_environment:
  - ANTHROPIC_API_KEY=sk-ant-api03-...
  - AWS_REGION=us-east-2
  - AWS_ACCESS_KEY_ID=AKIA...
  - AWS_SECRET_ACCESS_KEY=...
  - AWS_S3_BUCKET=mindorganizer
  - AWS_S3_PREFIX=dev
```

`config.local.yaml` falls under the `.ddev/` ignore rule in `backend/.gitignore`, so it stays local.

After editing, `ddev restart` to apply.

PHP reads them with `getenv('VAR_NAME')`.

#### Things that look like env-var sources but aren't

- `backend/.ddev/web-environment` — leftover from an older DDEV pattern. Current DDEV does **not** read this file. Safe to delete.
- `backend/.env.prod` — a personal local reference file. Not used by anything at runtime. Production reads from a different `.env` on the server (see below).

### Production — Docker Compose on DigitalOcean

The production stack is defined in `backend/docker-compose.prod.yml` (committed, no secrets). At runtime, Docker Compose substitutes `${VAR_NAME}` references from a file literally named `.env` in the same directory as the compose file:

```
/home/deploy/mind-organizer/backend/.env
```

This `.env` lives **only on the production server**, is not in git, and is not in GitHub Secrets. It was placed there manually when the server was set up. To add new vars, SSH in and edit:

```bash
ssh deploy@<DO_HOST>
cd /home/deploy/mind-organizer/backend
nano .env  # or: cat >> .env <<'EOF' ... EOF
```

Then redeploy (or restart containers manually) so the new env values are picked up.

#### How values flow in production

```
GitHub push to main
  └─> .github/workflows/backend-deploy.yml
        └─> SSH to DO server
              └─> git pull origin main
              └─> docker compose -f docker-compose.prod.yml up -d
                    └─> reads ${VAR} from /home/deploy/mind-organizer/backend/.env
                    └─> substitutes into php container's `environment:` block
                          └─> PHP getenv('VAR') reads the substituted value
```

The GitHub workflow only uses these GitHub Secrets: `DO_HOST`, `DO_USER`, `DO_SSH_KEY`. It does NOT inject application secrets — those live in the server's `.env`.

#### Adding a new backend env var (full checklist)

1. **Local**: add it to `backend/.ddev/config.local.yaml` → `ddev restart`
2. **Local docs**: optionally add the var name (with placeholder) to `backend/.ddev/config.yaml` so the var name is visible in the committed config
3. **Repo**: add it to `backend/docker-compose.prod.yml`'s `php.environment:` block as `MY_VAR: ${MY_VAR}` (commit this — only the name leaks, not the value)
4. **Server**: SSH in and add `MY_VAR=actual-value` to `/home/deploy/mind-organizer/backend/.env`
5. **Deploy**: next deploy (or `docker compose up -d --force-recreate php`) restarts the container with the new env

---

## Verifying env vars are loaded

### Frontend (local)

```bash
cd frontend
npm run dev
# In the running terminal, the value is visible in any route handler via process.env
```

Or temporarily add `console.log(process.env.MY_VAR)` to a route handler.

### Backend (local DDEV)

Quick sanity check:

```bash
ddev exec 'env | grep MY_VAR'
```

Drupal-context check (most realistic — bootstraps Drupal):

```bash
ddev drush ev 'echo getenv("MY_VAR");'
```

Web-request-context check (simulates what PHP-FPM sees during a real HTTP request):

```bash
echo '<?php echo getenv("MY_VAR");' > backend/web/env-test.php
curl -sk https://backend.ddev.site/env-test.php
rm backend/web/env-test.php
```

### Backend (production)

```bash
ssh deploy@<DO_HOST>
cd /home/deploy/mind-organizer/backend
docker compose -f docker-compose.prod.yml exec -T php sh -c 'env | grep MY_VAR'
```

---

## Common pitfalls we hit

1. **`ddev exec 'php -r ...'` was returning placeholders** before `config.local.yaml` was set up. Reason: PHP CLI inside `ddev exec` reads from the merged `web_environment:`, which only contained `config.yaml`'s placeholders. Once `config.local.yaml` exists with real values, both CLI and PHP-FPM see them.

2. **`backend/.ddev/web-environment` looks meaningful but isn't**. It's not loaded by current DDEV. Verified by inspecting the auto-generated `.ddev/.ddev-docker-compose-full.yaml` — only `config.yaml` (and any `config.*.yaml` overrides) feed the container `environment:` block.

3. **`backend/.env.prod` looks like the production secrets file but isn't**. It's a personal reference file. Production reads from `/home/deploy/mind-organizer/backend/.env` (no `.prod` suffix), which Docker Compose finds by default in the compose file's directory.

4. **Drupal's `AiFlashcardService.php` looks like the AI integration but isn't used**. The actual Anthropic calls happen from Next.js using `frontend/.env.local`. The PHP code path has been dead, which is why the placeholder `ANTHROPIC_API_KEY=your-key-here` in `config.yaml` never broke anything.

---

## Summary table

| Variable | Used by | Local source | Production source |
|---|---|---|---|
| `NEXT_PUBLIC_DRUPAL_BASE_URL` | Next.js client + server | `frontend/.env.local` | Hosting platform env |
| `DRUPAL_CLIENT_ID` / `DRUPAL_CLIENT_SECRET` | Next.js (OAuth) | `frontend/.env.local` | Hosting platform env |
| `ANTHROPIC_API_KEY` | Next.js AI routes | `frontend/.env.local` | Hosting platform env |
| `TURNSTILE_SECRET_KEY` / `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Next.js auth | `frontend/.env.local` | Hosting platform env |
| `DB_HOST` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | Drupal | DDEV-managed (auto) | DO server `.env` |
| `HASH_SALT` | Drupal | DDEV-managed (auto) | DO server `.env` |
| `AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_S3_BUCKET` / `AWS_S3_PREFIX` | Drupal `media_functionality` module | `backend/.ddev/config.local.yaml` | DO server `.env` |
