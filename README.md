# Inkdrive: a free cloud for Excalidraw

<img src="brand/logo-wordmark.svg" alt="Inkdrive" height="64">

**New here? Start with [docs/START-HERE.md](docs/START-HERE.md)**: install, Google sign-in, server, and the Chrome Web Store, step by step.

The product name lives in one file, [brand/brand.json](brand/brand.json); icons are generated from
[brand/logo-icon.svg](brand/logo-icon.svg) with `npm run icons --workspace @ecd/extension`.

A Chrome extension + small backend that give excalidraw.com a free, Google-Drive-style cloud:
sign in with Google, see all your drawings, open one and keep editing, autosave, share by email.
Backend runs on the Oracle Cloud **Always Free** tier. Unaffiliated with Excalidraw.

```
apps/api         Fastify + PostgreSQL backend (auth, files, versions, sharing)
apps/extension   Chrome MV3 extension (button in Excalidraw, side panel, autosave)
packages/shared  Zod schemas + types shared by both (the API contract)
deploy/          docker-compose, Caddy (HTTPS), env template
```

## Status

| Area | State |
|---|---|
| API: Google sign-in (PKCE), rotating refresh tokens, files CRUD, optimistic-concurrency saves, 20 versions + restore, trash, quota, sharing by email | Built, 10 automated tests pass |
| Extension: Inkdrive button, side panel (sign in, list, search, tabs, **new drawing, upload .excalidraw files (picker or drag-and-drop), download, make a copy, version history**, save, open, rename, star, trash, share, storage meter), autosave, conflict and offline handling, dev sign-in | Built, type-checks and bundles. Not yet run as an installed Chrome extension |
| Excalidraw integration (`ExcalidrawBridge`) | **Verified** against Excalidraw's source and live excalidraw.com, see [SPIKE.md](SPIKE.md) |
| Invite emails, link sharing, web viewer, folders UI, thumbnails | Not built yet |

## Sign-in artwork

The turboprop-governor diagram on the sign-in screen lives in `brand/art/`: `turboprop.excalidraw` (54 real Excalidraw elements: open it
in Excalidraw, or **Upload file** it into Inkdrive), plus `turboprop.svg` and `turboprop.png`. It is drawn by
`npm run art --workspace @ecd/extension`, which renders the same elements with rough.js (the engine behind Excalidraw's hand-drawn look)
and Excalidraw's handwriting font converted to outlines, so it needs no font at runtime.

## Checks

```bash
npm run check
```

Runs everything that has to be true before shipping: typecheck of all packages, all tests (API: 46, extension logic: 10, shared
schemas: 6), a build of the API and the extension, and `verify-dist`, which validates the **built** extension: every file the
manifest points at exists, permissions are least-privilege, content scripts run only on excalidraw.com and our own `/s/*` link
page, the panel loads no remote files, no client secret is baked in, and a build for a real server contains **no dev sign-in code**.
The same command runs in CI (`.github/workflows/ci.yml`). Not covered by automation: the extension running inside real Chrome
(side panel, Google sign-in, toolbar click) — that needs a manual pass, see SPIKE.md.

## Develop

Requires Node 22+.

```bash
npm install
npm test                       # API tests (in-memory Postgres, no setup)
npm run typecheck              # all packages
```

Run the API locally (in-memory database, data is lost on restart):

```bash
cd apps/api
JWT_SECRET=$(openssl rand -hex 32) \
GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... \
ALLOWED_REDIRECT_URIS=https://<extension-id>.chromiumapp.org/ \
npm run dev
```

Build and load the extension:

```bash
API_URL=http://localhost:8787 npm run build:ext
```

Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → pick `apps/extension/dist`.
Copy the extension ID shown there; you need it for Google sign-in below.

### Try it without Google (dev sign-in)

```bash
# terminal 1: API with the dev login route and an in-memory database
cd apps/api && JWT_SECRET=$(openssl rand -hex 32) DEV_AUTH=1 npm run dev

# terminal 2: extension build that shows a "Dev sign-in" box in the panel
DEV_LOGIN=1 API_URL=http://localhost:8787 npm run build:ext
```

`DEV_AUTH=1` is refused together with a real `DATABASE_URL`, and `DEV_LOGIN=1` refuses to build for any
non-localhost `API_URL`, so neither can end up in production. Sign in as two different emails (two Chrome profiles)
to test sharing. Never load a `DEV_LOGIN` build as your everyday extension.

## Google sign-in setup (one time)

1. Google Cloud Console → APIs & Services → **OAuth consent screen** (External, add yourself as a test user).
2. **Credentials → Create OAuth client ID → Web application.**
   Authorized redirect URI: `https://<extension-id>.chromiumapp.org/`
3. Put the client ID and secret in the API's environment (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`)
   and the same redirect URI in `ALLOWED_REDIRECT_URIS`. The secret never goes in the extension.

## Deploy to Oracle Cloud Always Free

Step-by-step, hardened setup: **[deploy/RUNBOOK.md](deploy/RUNBOOK.md)**. In short: pin the extension id (`npm run pin-id`), set up Google
sign-in, create the Ampere VM and DNS record, then on the server run `deploy/bootstrap-host.sh` (key-only SSH, firewall, fail2ban,
automatic security updates, Docker), `deploy/gen-secrets.sh` (random secrets into a mode-600 `.env`) and `docker compose up -d --build`.
The stack keeps the database off the internet, runs the API and proxy read-only without extra privileges, and writes nightly backups
that are encrypted with a key that never lives on the server.

## Tags

Colour labels for files and folders (8 colours, up to 50 tags, 20 per item). Tag from an item's **⋯ menu → Tags…**, filter with the
tag chips under the tabs (one click on a chip lists everything with that tag, across every folder), and rename, recolour or delete
tags in **profile menu → Manage tags**. Tags are **private**: each person has their own, they are never shown to anyone else, and
you can tag things that were only shared with you.

## First run and settings

- **Start screen:** an empty *My files* shows a start screen modelled on Excalidraw's own (centred logo, handwriting, a short action
  list, handwritten captions with hand-drawn arrows at the controls). Replay it from the profile menu. Handwriting font: Excalifont
  (SIL Open Font License; licence text in `apps/extension/assets/fonts`). Hints hide themselves when the panel is too small.

- **Guided tour:** the first time you sign in, a step-by-step tour dims the panel and points hand-drawn arrows at search, upload, new,
  your spaces, file actions, autosave, the Encrypted chip and your profile. It runs once; replay it from the profile menu.
- **Profile menu (the avatar):** every setting lives here and nowhere else: storage meter, Autosave, hide Excalidraw's Sign in/Share,
  Theme (Auto / Light / Dark), Take the tour, Privacy and encryption, About, Sign out. To add a setting, add a key to `StoredState`
  (`src/protocol.ts`) and one row in `src/sidepanel/profile.tsx`.

## Folders and sharing (Google-Drive style)

- **Folders** nest to any depth; create from the **+** button, move with **Move to…**, breadcrumb on top. Trashing a folder
  hides what is inside it; restoring brings it back; deleting it forever deletes the contents.
- **Share files or folders** with people by email as **Viewer** or **Editor**. Access **flows down**: sharing a folder shares
  everything inside, and a stronger share on one item upgrades it. The dialog lists who has access, including people who get it
  from a parent folder (read-only, "Inherited from …").
- **General access:** *Restricted*, or *Anyone with the link* (Viewer or Editor). The link is `https://<api>/s/<token>`; opening it
  with the extension installed and signed in adds the item to **Shared with me** and opens it. Turning the link off cuts off everyone
  who came in through it immediately. Link access requires a Google sign-in; there is no anonymous access.
- **Ownership:** only owners move, trash, share or star. Things an editor creates inside someone's shared folder belong to that
  folder's owner, so a folder tree always has one owner. People can **Remove from Shared with me** for anything shared with them.
- **Not built yet:** invite emails, ownership transfer, comment-only role, a web viewer for people without the extension.

## Security notes

- **Encryption.** Traffic is HTTPS only. Every drawing is encrypted at rest with AES-256-GCM using `DATA_KEY`
  (`apps/api/src/crypto.ts`); each blob is bound to its file and revision, so it cannot be copied onto another row,
  and tampering is detected. Database dumps and backups therefore contain no readable drawings.
  This is **not end-to-end encryption**: the server holds the key so it can show and share drawings. File names,
  emails and share lists are stored in plain text (needed for search and sharing). Refresh tokens are stored only as hashes.
  **Back up `DATA_KEY` separately from the database. Losing it makes every drawing unreadable.** Rotate by moving the
  old key to `DATA_KEY_OLD`. With a real `DATABASE_URL` the server refuses to start without `DATA_KEY`.
  Not covered: the access token and your sign-in state in the browser's extension storage (standard for extensions).
- Every file route goes through one permission function (`apps/api/src/permissions.ts`); strangers get 404, never 403.
  `api.test.ts` tries every route as a stranger.
- Shares are tied to the invited **verified Google email**, so a forwarded invite cannot be used by another account.
- Refresh tokens are stored hashed, rotate on every use, and reuse revokes the whole session family.
- The extension runs only on excalidraw.com; permissions: `storage`, `identity`, `sidePanel`, `alarms`.
- Known dependency note: `zod@3` has an advisory about memory use on oversized *constrained* collections. We set no
  collection limits and cap request bodies at 11 MB, so impact is low; plan an upgrade to zod 4.

## Design

See the design canvas and the system design doc shared in the project conversation. The most important rules:
the scene is stored as opaque Excalidraw JSON, all Excalidraw-specific code lives in
`apps/extension/src/content/bridge.ts` and `hook.ts`, and the API is versioned under `/v1`.
