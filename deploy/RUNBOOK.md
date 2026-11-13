# Deploying Inkdrive securely (Oracle Cloud Always Free)

Everything below is copy-paste. Time: about an hour the first time. Cost: $0.

> **Honest status:** the scripts, compose file and tests are checked, but none of this has been run on a live Oracle VM yet.
> Do the steps in order, keep your first SSH session open until you've logged in again from a second window, and
> tell me the first thing that doesn't match.

## What you need
- An Oracle Cloud account (upgrade to Pay-As-You-Go: it stays $0 inside Always Free and stops Oracle reclaiming an idle VM)
- A domain you control (a subdomain like `api.yourdomain.com` is enough)
- A Google account for the OAuth client
- This repo on your computer with Node 22, plus `age` (`brew install age`)

## 1. On your computer: pin the extension id and make a backup key

```bash
npm install
npm run pin-id --workspace @ecd/extension      # prints your extension id; creates a private key (gitignored)
age-keygen -o backup-key.txt                   # prints "Public key: age1..."  <- copy that line
```
- **Back up** `apps/extension/.extension-key.pem` and `backup-key.txt` in a password manager. Never commit or upload them.
  `backup-key.txt` is the ONLY way to read your database backups; it must never live on the server.
- The extension id is needed for Google sign-in and the server's CORS rule, and it must not change: that is what the pin is for.

## 2. Google sign-in (one time)
1. Google Cloud Console, **APIs & Services, OAuth consent screen**: External. Scopes: only `openid`, `email`, `profile`.
   Add yourself as a test user (or publish: these scopes need no Google review).
2. **Credentials, Create OAuth client ID, Web application.** Authorized redirect URI, exactly:
   `https://<your-extension-id>.chromiumapp.org/`
3. Keep the client id and secret handy for step 5. The secret lives only on the server.

## 3. Oracle: the server
1. Compute, **Create instance**: Ubuntu 24.04, shape **Ampere A1** (2 OCPU, 12 GB), boot volume 50 GB, paste your SSH **public** key.
   If it says "out of capacity", try again later or another availability domain.
2. Networking: attach a **reserved public IP** (free). In the VCN **Security List** allow ingress:
   TCP **22** from **your IP only**, TCP **80** and **443** from `0.0.0.0/0`.
3. DNS: an **A record** `api.yourdomain.com` pointing at the IP.
   (If you proxy through Cloudflare: SSL mode **Full (strict)**, and in `deploy/Caddyfile` change the `header_up X-Forwarded-For` value to
   `{http.request.header.CF-Connecting-IP}` so rate limits see real visitors.)

## 4. On the server: harden, then install
```bash
ssh ubuntu@<server-ip>
git clone https://github.com/7pk5/Inkdrive.git && cd Inkdrive/deploy
sudo ./bootstrap-host.sh        # updates, auto security updates, key-only SSH, firewall, fail2ban, Docker, age
```
Open a **second** terminal and `ssh` in again to confirm you can still log in before closing the first.

## 5. Secrets and start
```bash
./gen-secrets.sh                 # asks for domain, Google client id/secret, extension id, age public key
grep '^DATA_KEY=' .env           # copy this into your password manager NOW (see "The one key you must not lose")
docker compose up -d --build
curl -fsS https://api.yourdomain.com/health        # {"ok":true}
docker compose ps && docker compose logs --tail 50 api
```
`gen-secrets.sh` writes random secrets to `deploy/.env` (mode 600), never prints them, and never overwrites an existing file.

## 6. Build the extension for your server
On your computer:
```bash
API_URL=https://api.yourdomain.com npm run build:ext
npm run verify --workspace @ecd/extension      # must say: ok ... (pinned) ... and no dev sign-in code
```
Load `apps/extension/dist` in Chrome (or zip it for the Web Store). The build refuses to include the dev sign-in for a real server.

## 7. Prove it works (10 minutes)
- Sign in with Google, save a drawing, reload, open it again.
- **Check encryption at rest:**
  `docker compose exec db psql -U ecd -d ecd -c "select encode(substr(scene,1,2),'hex') from file_versions limit 1"`
  should print `ec01` (sealed), never `1f8b` (plain gzip).
- Check the firewall from your computer: `nmap -Pn <server-ip>` shows only 22, 80, 443; port 5432 must be closed.
- Wait for the first backup (it runs 1 minute after start): `ls -l backups/` then do the restore drill below once.

## Backups
- A nightly dump, compressed and **encrypted with your age public key**, lands in `deploy/backups/` (kept 14 days).
- **Copy it off the server** so one dead disk can't take everything. Free option: an Oracle Object Storage bucket (20 GB free) with `rclone`
  (its S3-compatible endpoint), run from cron, for example `rclone copy ~/Inkdrive/deploy/backups oci:inkdrive-backups`.
- **Restore drill** (do it once now, then monthly), on your computer, with `backup-key.txt`:
  ```bash
  scp ubuntu@<server-ip>:Inkdrive/deploy/backups/<latest>.sql.gz.age .
  age -d -i backup-key.txt <latest>.sql.gz.age | gunzip | head      # you should see SQL
  ```
  To really restore into a fresh database: `docker compose exec db createdb -U ecd ecd_restore_test` then pipe the same output into
  `docker compose exec -T db psql -U ecd -d ecd_restore_test`.
- Remember: a backup holds your **encrypted drawings**, so it is only useful together with `DATA_KEY`.

## The one key you must not lose
`DATA_KEY` encrypts every drawing. If it is lost, every stored drawing is unreadable, backups included.
Keep a copy in a password manager, separate from the server and from the backups.
To rotate it: put the new key in `DATA_KEY` and the previous one in `DATA_KEY_OLD` (comma-separated list), then `docker compose up -d`.
Old drawings keep opening; new saves use the new key.

## Updates
```bash
cd ~/Inkdrive && git pull && cd deploy && docker compose up -d --build
```
Database migrations run automatically at start. Check `docker compose logs --tail 30 api` afterwards.

## Watching it
- Free uptime alert: point UptimeRobot (or similar) at `https://api.yourdomain.com/health` (it returns 503 if the database is down).
- Logs: `docker compose logs -f caddy api`. Blocked SSH attempts: `sudo fail2ban-client status sshd`.
- Disk: `df -h` now and then (drawings are small; the encrypted backups are the main growth).

## What is and is not protected
- **Protected:** traffic (HTTPS only, HSTS), drawings at rest (AES-256-GCM), the database (no route to the internet, nothing published),
  containers (read-only, no extra privileges), SSH (keys only), the secrets (random, mode 600, never in git or images), backups (encrypted).
- **Not protected, by design:** this is not end-to-end encryption. The server holds `DATA_KEY` so it can show and share drawings, so someone with
  root on the running server can read them. File names and emails are stored in plain text so search works.
- **Your responsibilities:** `DATA_KEY`, `backup-key.txt` and the extension key are never recoverable by anyone else.

## If something goes wrong
- API won't start: `docker compose logs api`. A missing or empty value in `.env` is reported by name.
- Google says redirect_uri_mismatch: the redirect URI in Google must be exactly `https://<extension-id>.chromiumapp.org/`, and the extension must be the pinned build.
- Port 80/443 unreachable: check the Oracle Security List first, then `sudo ufw status` and `sudo iptables -S INPUT`.
- Locked out of SSH: use the Oracle console's **Instance console connection**; do not reopen password login.
