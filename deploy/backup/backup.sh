#!/bin/sh
# Nightly encrypted database backup. Runs forever inside the `backup` container.
#   restore:  age -d -i backup-key.txt ecd-YYYY-MM-DD-HHMM.sql.gz.age | gunzip | psql ...   (see RUNBOOK.md)
set -eu

: "${BACKUP_AGE_RECIPIENT:?set BACKUP_AGE_RECIPIENT to your age public key (age1...)}"
case "$BACKUP_AGE_RECIPIENT" in age1*) ;; *) echo "BACKUP_AGE_RECIPIENT must start with age1" >&2; exit 1 ;; esac

backup_once() {
  stamp="$(date +%F-%H%M)"
  out="/backups/ecd-$stamp.sql.gz.age"
  tmp="/tmp/ecd-$stamp.sql"
  # Dump to a file first so a failed pg_dump can never be mistaken for a good backup.
  if pg_dump -h db -U ecd --no-owner ecd > "$tmp" && gzip -9 < "$tmp" | age -r "$BACKUP_AGE_RECIPIENT" > "$out.partial"; then
    mv "$out.partial" "$out"
    echo "backup ok: $out ($(wc -c < "$out") bytes)"
  else
    echo "backup FAILED at $stamp" >&2
    rm -f "$out.partial"
  fi
  rm -f "$tmp" # the plain dump never stays on disk
  find /backups -name 'ecd-*.sql.gz.age' -mtime +14 -delete
}

# first backup shortly after start (so a broken setup shows up today, not in a month), then every 24 h
sleep 60
while true; do
  backup_once
  sleep 86400
done
