#!/usr/bin/env bash
# One-time hardening of a fresh Ubuntu 22.04/24.04 server (tested logic, NOT yet run on a live Oracle VM:
# read it first, and keep your current SSH session open until you have logged in again from a second window).
#   sudo ./bootstrap-host.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "==> system updates and tools"
apt-get update -y
apt-get upgrade -y
apt-get install -y ca-certificates curl git ufw fail2ban unattended-upgrades docker.io docker-compose-v2 age openssl iptables-persistent
systemctl enable --now docker fail2ban

echo "==> automatic security updates"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

echo "==> SSH: keys only, no root login (your key must already work!)"
if ! [ -s "${SUDO_USER:+/home/$SUDO_USER}/.ssh/authorized_keys" ] && ! [ -s /root/.ssh/authorized_keys ]; then
  echo "No authorized_keys found: refusing to disable password login (you could lock yourself out)." >&2
  exit 1
fi
cat > /etc/ssh/sshd_config.d/99-inkdrive.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
MaxAuthTries 3
LoginGraceTime 20
EOF
sshd -t
systemctl reload ssh || systemctl reload sshd

echo "==> firewall: only SSH, HTTP, HTTPS in"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# Oracle's Ubuntu images ship an iptables rule that REJECTs everything not explicitly allowed, ahead of ufw's rules.
# With ufw now in charge, remove that rule so 80/443 actually reach Caddy.
if iptables -S INPUT | grep -q -- "-j REJECT --reject-with icmp-host-prohibited"; then
  echo "==> removing Oracle's default REJECT rule (ufw handles the policy now)"
  iptables -D INPUT -j REJECT --reject-with icmp-host-prohibited || true
  netfilter-persistent save || true
fi

echo
echo "Done. Also required in the Oracle console (VCN > Security List): allow ingress TCP 80 and 443 from 0.0.0.0/0,"
echo "and TCP 22 only from your own IP. Then: cd deploy && ./gen-secrets.sh && docker compose up -d --build"
