#!/bin/bash
# setup-ssl.sh — Run ONCE on EC2 to get SSL cert and configure nginx
# Run this manually after DNS has propagated:
#   ssh ec2-user@34.229.154.15 'sudo bash /tmp/deploy-notesview/deploy/setup-ssl.sh'

set -euo pipefail
DOMAIN="siplgo.xyz"
EMAIL="dan@siplgo.xyz"

if [ -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]; then
  echo "SSL certificate already exists. Renewing if needed..."
  sudo certbot renew --quiet || true
  exit 0
fi

echo "=== 1. Install nginx & certbot ==="
sudo dnf install -y nginx certbot python3-certbot-nginx

echo "=== 2. Copy nginx config ==="
sudo cp /tmp/deploy-notesview/deploy/nginx-notesview.conf /etc/nginx/conf.d/notesview.conf

echo "=== 3. Start nginx ==="
sudo systemctl enable --now nginx
sudo nginx -t && sudo systemctl reload nginx

echo "=== 4. Get SSL certificate ==="
sudo certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos -m "$EMAIL"

echo "=== 5. Reload nginx with HTTPS ==="
sudo nginx -t && sudo systemctl reload nginx

echo "=== 6. Enable auto-renewal ==="
sudo systemctl enable --now certbot-renew.timer 2>/dev/null || true

echo "=== Done! https://$DOMAIN ==="
