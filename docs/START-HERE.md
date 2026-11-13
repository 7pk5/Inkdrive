# Inkdrive: from zero to live, and onto the Chrome Web Store

Follow the parts in order. Total time: about 2 hours the first time (plus the store's review wait). Cost: **$0**, except the one-time
**$5** Chrome Web Store fee and, optionally, about $10 a year for your own domain.

| Part | What you do | Time |
|---|---|---|
| 1 | Get the accounts you need | 20 min |
| 2 | Install the tools on your computer | 10 min |
| 3 | Make your keys | 5 min |
| 4 | Set up "Sign in with Google" | 15 min |
| 5 | Get a web address (domain) | 10 min |
| 6 | Create the free Oracle server | 20 min |
| 7 | Put Inkdrive on the server | 15 min |
| 8 | Test it in your own Chrome | 10 min |
| 9 | Publish on the Chrome Web Store | 45 min + review |
| 10 | Keeping it running | ongoing |

---

## Part 1. Accounts you need
1. **Google account**: you have one. It must have **2-step verification** turned on (the Chrome Web Store requires it).
2. **Oracle Cloud** account: <https://www.oracle.com/cloud/free/>. It asks for a card to prove you're a person; the Always Free resources cost nothing.
3. **A domain name** (Part 5): your own, or a free `something.duckdns.org`.
4. **Chrome Web Store developer account** (Part 9): one-time $5.

## Part 2. Install the tools on your computer
**Mac** (Windows users: install WSL with Ubuntu first, then type the same commands inside it).

```bash
# 1. Homebrew, the Mac package installer (skip if `brew --version` already works)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. Node.js (runs the build), Git (gets the code), age (encrypts your backups)
brew install node git age

# 3. Get the code and check everything works
git clone https://github.com/7pk5/Inkdrive.git
cd Inkdrive
npm install
npm run check          # must end without errors
```

## Part 3. Make your keys (on your computer, not the server)
```bash
npm run pin-id --workspace @ecd/extension     # prints your extension id (32 letters); creates a private key file
age-keygen -o backup-key.txt                  # prints "Public key: age1..."  (copy that line)
```
Write these down:
- **Extension id**: for example `kcbfjgnnbabgokinhehoampdlmekefip`.
- **age public key**: the line starting `age1...`.

Back these files up in a password manager. **Never** put them in git or on the server:
- `apps/extension/.extension-key.pem` (your extension's signing key)
- `backup-key.txt` (the only way to read your database backups)

## Part 4. Set up "Sign in with Google" (this is how users add their Google account)
Inkdrive never sees passwords. People click **Continue with Google**, pick their account, and Google tells our server who they are.

1. Open <https://console.cloud.google.com/> and sign in. Top bar, project picker, **New project**, name it `Inkdrive`, **Create**.
2. Menu, **APIs & Services**, **OAuth consent screen** (Google now calls this area **Google Auth Platform**).
   - App name: `Inkdrive`. Support email: yours. Audience: **External**. Contact email: yours.
   - **Data access / Scopes**: add only `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`. Nothing else.
3. **Credentials** (or **Clients**), **Create credentials**, **OAuth client ID**:
   - Application type: **Web application**. Name: `Inkdrive server`.
   - **Authorized redirect URIs**, add exactly (with your extension id from Part 3):
     `https://<your-extension-id>.chromiumapp.org/`
   - **Create**. Copy the **Client ID** (ends `.apps.googleusercontent.com`) and the **Client secret**. Keep them for Part 7.
4. Who can sign in:
   - **Just you and friends**: leave the app in **Testing** and add each person under **Audience, Test users** (up to 100). Because we only ask for
     basic profile scopes, sign-ins do not expire after 7 days.
   - **Everyone**: on the Audience page click **Publish app** ("In production"). With only these basic scopes Google needs no security review, but it may ask for
     a homepage and privacy-policy link on a domain you own (see Part 9).
5. You will add a **second** redirect URI later, in Part 9, for the id the Chrome Web Store assigns.

## Part 5. Get a web address
The server needs a name like `api.yourdomain.com` that points at it.
- **Free**: <https://www.duckdns.org>, sign in with Google, create a name like `inkdrive`, giving `inkdrive.duckdns.org`. You'll paste the server's IP into it in Part 6.
- **Your own domain**: buy one (Cloudflare Registrar, Namecheap, ...), then add an **A record** named `api` pointing at the server's IP in Part 6.

## Part 6. Create the free Oracle server
1. Sign in at <https://cloud.oracle.com>. Menu, **Billing**, **Upgrade to Pay As You Go**. It stays $0 while you use only Always Free resources, and it stops Oracle reclaiming an idle server.
2. On your computer make an SSH key (your login for the server):
   ```bash
   ssh-keygen -t ed25519 -C inkdrive        # press Enter for the defaults
   cat ~/.ssh/id_ed25519.pub                # copy this whole line
   ```
3. Menu, **Compute**, **Instances**, **Create instance**:
   - Image: **Canonical Ubuntu 24.04**.
   - Shape: **Change shape**, **Ampere**, **VM.Standard.A1.Flex**, **2 OCPU, 12 GB**.
   - Networking: keep the defaults and make sure **Assign a public IPv4 address** is on.
   - **Add SSH keys**: paste the line you copied.
   - Boot volume: 50 GB. **Create**. If it says **Out of capacity**, wait an hour and retry, or pick another availability domain.
4. Make the address permanent: **Networking**, **Reserved public IPs**, **Reserve**, then attach it to the instance's network interface. Write the IP down. Put it into DuckDNS (or your A record).
5. Open only the ports we need: **Networking**, your **VCN**, the **subnet**, **Security List**, **Add Ingress Rules**:
   - TCP **22** from `<your own IP>/32` (find it by searching "what is my ip"). Not `0.0.0.0/0`.
   - TCP **80** from `0.0.0.0/0`, and TCP **443** from `0.0.0.0/0`.

## Part 7. Put Inkdrive on the server
```bash
ssh ubuntu@<your-server-ip>
git clone https://github.com/7pk5/Inkdrive.git
cd Inkdrive/deploy
sudo ./bootstrap-host.sh
```
That installs Docker, turns on the firewall, makes SSH key-only, and enables automatic security updates.
**Before closing this window, open a second terminal and `ssh` in again** to make sure you can still log in.

Then:
```bash
./gen-secrets.sh
```
It asks you for:
| It asks | Where it comes from |
|---|---|
| API domain | Part 5, for example `inkdrive.duckdns.org` (no `https://`) |
| Google OAuth client id / secret | Part 4 step 3 |
| Extension id | Part 3 |
| age public key | Part 3 (`age1...`) |

It creates random passwords and keys itself and stores them in `deploy/.env` (readable only by you). Then:
```bash
grep '^DATA_KEY=' .env         # copy this line into your password manager NOW
docker compose up -d --build   # first run takes a few minutes
curl -fsS https://<your-domain>/health      # should print {"ok":true}
```
`DATA_KEY` encrypts every drawing. **If you lose it, every drawing is unreadable, backups included.**
If `curl` fails with a certificate error, your DNS name isn't pointing at the server yet; wait a few minutes and retry.

## Part 8. Test it in your own Chrome
On your computer, in the `Inkdrive` folder:
```bash
API_URL=https://<your-domain> npm run build:ext
npm run verify --workspace @ecd/extension      # must say ok, "(pinned)", and mention no dev sign-in
```
1. Chrome, `chrome://extensions`, turn on **Developer mode**, **Load unpacked**, choose `apps/extension/dist`.
2. Open <https://excalidraw.com>. Click the **Inkdrive** button next to Library, then **Continue with Google**.
3. Draw something. After a few seconds the footer says it is saved. Reload the page and open the file from the list.
4. Prove drawings are encrypted at rest (on the server, in `Inkdrive/deploy`):
   ```bash
   docker compose exec db psql -U ecd -d ecd -c "select encode(substr(scene,1,2),'hex') from file_versions limit 1"
   ```
   It must print `ec01`. If it printed `1f8b`, stop and tell me.

If Google shows `redirect_uri_mismatch`, the redirect URI in Part 4 doesn't exactly match `https://<extension-id>.chromiumapp.org/`, or you loaded a build that wasn't made with your pinned key.

## Part 9. Publish on the Chrome Web Store

### 9.1 Register (once)
1. Go to <https://chrome.google.com/webstore/devconsole> signed in with your Google account (2-step verification on).
2. Accept the developer agreement and pay the **$5 one-time** registration fee. Verify the contact email it sends.

### 9.2 Build the upload package
```bash
API_URL=https://<your-domain> npm run pack:store --workspace @ecd/extension
```
This builds for your server, validates the build, and creates `apps/extension/inkdrive-<version>.zip`. It deliberately has **no** pinned key
(the store assigns the id) and **no** dev sign-in.

### 9.3 Upload
Dashboard, **Add new item**, upload the zip. Open the item: the store shows its **Item ID** (32 letters). **This is your real production extension id.**

### 9.4 Tell the server and Google the new id (required, or sign-in breaks for store users)
1. **Google Cloud Console**, your OAuth client, **Authorized redirect URIs**, **add** `https://<store-item-id>.chromiumapp.org/` (keep the old one for your own testing).
2. **Server**: edit `deploy/.env` and make both lines list both ids, comma-separated:
   ```
   ALLOWED_REDIRECT_URIS=https://<pinned-id>.chromiumapp.org/,https://<store-id>.chromiumapp.org/
   CORS_ORIGINS=chrome-extension://<pinned-id>,chrome-extension://<store-id>
   ```
   then `docker compose up -d`.

### 9.5 Fill in the listing (Store listing tab)
- **Name**: `Inkdrive for Excalidraw`. **Summary** (max 132 characters): `Your Excalidraw drawings, saved free in the cloud. Folders, sharing, tags, autosave and encryption.`
- **Description**: what it does, how to sign in, that drawings are encrypted at rest, and that you need a Google account.
- **Category**: Productivity. **Language**: English.
- **Icon**: 128x128 is included. **Screenshots**: at least one, 1280x800 (or 640x400), up to five. Take them of the panel next to a real drawing.
  **Small promo tile**: 440x280 is required.
- If you want, I can generate the screenshots and the promo tile from the real app.

### 9.6 Privacy tab (the part reviewers read closely)
- **Single purpose**: `Save, organise and share Excalidraw drawings in the user's own cloud storage while using excalidraw.com.`
- **Permission justifications** (paste these):
  | Permission | Why |
  |---|---|
  | `storage` | Keeps the signed-in session and the user's settings (autosave, theme) in the browser. |
  | `identity` | Runs Google sign-in so the user can access their own drawings. |
  | `sidePanel` | Shows the file list and sharing controls next to the canvas. |
  | `alarms` | Retries a save once a minute after a network failure so no work is lost. |
  | Host `https://excalidraw.com/*` | Reads the drawing on the canvas to save it, and loads a saved drawing back onto the canvas. |
  | Host `https://<your-domain>/*` | Talks to the Inkdrive server that stores the user's drawings. |
- **Remote code**: **No**. (Everything is bundled in the package.)
- **Data usage**: tick **Personally identifiable information** (name and email from Google), **Authentication information** (sign-in tokens), and
  **Website content** (the drawing read from excalidraw.com). Then tick all three certifications: not sold, not used for unrelated purposes, not used for credit decisions.
- **Privacy policy URL** (required because you handle personal data): a public page, for example on GitHub Pages or your domain. A starting text is at the end of this guide.
  Have it reviewed; it is a template, not legal advice.

### 9.7 Distribution
Choose **Unlisted** first (anyone with the link can install; not searchable) or **Private** (named testers). Move to **Public** when you are happy.

### 9.8 Submit and wait
Press **Submit for review**. Reviews usually take a few days; broad permissions can take longer. Common reasons for rejection, and how to avoid them:
- **Name or logo that implies it is made by Excalidraw.** The file icon uses Excalidraw's logo and the name ends in "for Excalidraw". Reviewers can treat this as
  impersonation or trademark misuse. The safest fix is a neutral file icon and the name `Inkdrive`; ask me and I'll change it.
- **Missing or generic privacy policy**, or a policy that doesn't match the data you actually collect.
- **Unclear single purpose** or permission reasons that don't match what the code does (use the text above).

### 9.9 Releasing updates
Raise `"version"` in `apps/extension/manifest.json` (it must go up, for example `0.1.1`), run `pack:store` again, upload the new zip under **Package, Upload new package**, and submit.
Updates are reviewed again but are usually faster. Users get them automatically.

## Part 10. Keeping it running
- **Update the server**: `cd ~/Inkdrive && git pull && cd deploy && docker compose up -d --build` (database migrations run by themselves).
- **Backups** run nightly into `deploy/backups/` (encrypted). Copy them off the server and do the restore drill from `deploy/RUNBOOK.md` once.
- **Know when it is down**: add `https://<your-domain>/health` to a free monitor such as UptimeRobot.
- **Deleting a person's data** is manual for now (a database command). Before a public launch I recommend adding a proper in-app **Delete my account**; it isn't built yet.
- More detail on every server step is in [deploy/RUNBOOK.md](../deploy/RUNBOOK.md).

## Troubleshooting
| Symptom | Likely cause and fix |
|---|---|
| `Out of capacity` creating the server | Retry later or choose another availability domain. |
| `curl https://.../health` certificate error | DNS doesn't point at the server yet, or ports 80/443 are closed in the Oracle Security List. |
| Can't reach the server on 80/443 | Oracle Security List first, then `sudo ufw status` on the server. |
| `redirect_uri_mismatch` from Google | The redirect URI must be exactly `https://<extension-id>.chromiumapp.org/` for the id the build actually has. |
| Sign-in works locally but not from the store version | You didn't do 9.4 for the store's id. |
| Store says "manifest key not allowed" | You uploaded a build made with `build:ext`; use `pack:store`, which leaves the key out. |
| API won't start | `docker compose logs api` names any missing setting. |
| Lost `DATA_KEY` | Drawings can't be recovered. Keep it in a password manager. |

---

## Privacy policy: starting text
> **Inkdrive privacy policy.** Last updated: <date>.
>
> **What we collect.** When you sign in with Google we receive your name, email address and profile picture. We store the drawings you save, their names, folders, tags, version history and sharing settings, and technical logs of sign-ins and sharing actions.
>
> **What we do with it.** Only to run Inkdrive: sign you in, store and show your drawings, and let you share them with the people you choose. We do not sell your data, show ads, or use it for anything else. We do not use analytics or tracking.
>
> **Who can see your drawings.** You, and people you share them with (by email or link). Our server decrypts drawings to show them to those people.
>
> **Security.** All traffic uses HTTPS. Drawings are stored encrypted (AES-256-GCM). Sign-in tokens are stored as hashes. This is not end-to-end encryption: the server can read drawings in order to display and share them.
>
> **Google data.** Inkdrive's use of information received from Google follows the Google API Services User Data Policy, including the Limited Use requirements.
>
> **Retention and deletion.** We keep your data until you delete it. Items in the trash can be restored until you delete them permanently. To have your account and data deleted, email <your contact email>.
>
> **Children.** Inkdrive is not directed at children under 13.
>
> **Changes.** We will update this page if this policy changes.
>
> **Contact.** <your contact email>.
