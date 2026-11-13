#!/usr/bin/env bash
# Creates deploy/.env with fresh random secrets (mode 600). Run once, on the server.
#   ./gen-secrets.sh
# It never overwrites an existing .env, and it never prints secrets to the screen.
set -euo pipefail
cd "$(dirname "$0")"

if [ -e .env ]; then
  echo "deploy/.env already exists, so I will not overwrite it." >&2
  echo "Move it away first if you really want new secrets (NEW DATA_KEY = old drawings unreadable!)." >&2
  exit 1
fi
command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }

ask() { # ask VAR "prompt" "regex" "hint"
  local var="$1" prompt="$2" re="$3" hint="$4" val
  while true; do
    read -r -p "$prompt" val
    if [[ "$val" =~ $re ]]; then printf -v "$var" '%s' "$val"; return; fi
    echo "  -> $hint" >&2
  done
}

echo "Inkdrive server setup. You need: a domain pointing at this server, your Google OAuth client,"
echo "your extension id (npm run pin-id), and an age PUBLIC key for backups."
echo
ask API_DOMAIN "API domain (for example api.example.com): " '^[a-zA-Z0-9]([a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}$' "a plain domain name, no https:// and no path"
ask GOOGLE_CLIENT_ID "Google OAuth client id: " '^[0-9A-Za-z._-]+\.apps\.googleusercontent\.com$' "it ends in .apps.googleusercontent.com"
read -r -s -p "Google OAuth client secret (typing is hidden): " GOOGLE_CLIENT_SECRET
echo
[ -n "$GOOGLE_CLIENT_SECRET" ] || { echo "the client secret cannot be empty" >&2; exit 1; }
ask EXTENSION_ID "Extension id (32 letters a-p): " '^[a-p]{32}$' "32 lowercase letters from a to p; run 'npm run pin-id' on your computer"
ask BACKUP_AGE_RECIPIENT "age PUBLIC key for backups (age1...): " '^age1[0-9a-z]{50,}$' "make one on YOUR computer with: age-keygen -o backup-key.txt (the line starting with age1)"

umask 077
{
  echo "# Written by gen-secrets.sh. Mode 600. Never commit or share this file."
  echo "API_DOMAIN=$API_DOMAIN"
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
  echo "JWT_SECRET=$(openssl rand -hex 32)"
  echo "# Encrypts every drawing. LOSE THIS = EVERY DRAWING IS UNREADABLE. Keep a copy in a password manager."
  echo "DATA_KEY=$(openssl rand -base64 32)"
  echo "DATA_KEY_OLD="
  echo "GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID"
  echo "GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET"
  echo "ALLOWED_REDIRECT_URIS=https://$EXTENSION_ID.chromiumapp.org/"
  echo "CORS_ORIGINS=chrome-extension://$EXTENSION_ID"
  echo "BACKUP_AGE_RECIPIENT=$BACKUP_AGE_RECIPIENT"
} > .env
chmod 600 .env
mkdir -p backups

echo
echo "Wrote deploy/.env (mode 600). Next:"
echo "  1. Copy DATA_KEY somewhere safe, OFF this server:   grep '^DATA_KEY=' .env"
echo "  2. Start everything:                                docker compose up -d --build"
echo "  3. Check it:                                        curl -fsS https://$API_DOMAIN/health"
