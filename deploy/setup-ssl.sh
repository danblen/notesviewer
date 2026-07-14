#!/bin/bash
# setup-ssl.sh — Run ONCE on EC2 to get SSL cert and configure nginx
# Idempotent: safe to re-run on every deploy

set -euo pipefail
DOMAIN="siplgo.xyz"
EMAIL="dan@siplgo.xyz"

echo "=== 1. Copy HTTP nginx config ==="
sudo cp /tmp/deploy-notesview/deploy/nginx-notesview.conf /etc/nginx/conf.d/notesview.conf
# Remove default nginx config that conflicts on port 80
sudo rm -f /etc/nginx/conf.d/default.conf

echo "=== 2. Ensure nginx is installed and running ==="
sudo dnf install -y nginx certbot python3-certbot-nginx
sudo systemctl enable --now nginx
sudo nginx -t && sudo systemctl reload nginx

# If SSL cert already exists, we're done
if [ -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]; then
  echo "=== SSL certificate exists. Renewing if needed... ==="
  sudo certbot renew --quiet || true
  exit 0
fi

echo "=== 3. Get SSL certificate (retry-safe) ==="
# Retry certbot up to 3 times — DNS propagation may have been delayed
for i in 1 2 3; do
  echo "Attempt $i/3..."
  if sudo certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos -m "$EMAIL"; then
    echo "=== SSL certificate obtained successfully ==="
    break
  fi
  if [ $i -lt 3 ]; then
    echo "certbot failed, waiting 30s before retry..."
    sleep 30
  fi
done

echo "=== 4. Reload nginx with HTTPS ==="
sudo nginx -t && sudo systemctl reload nginx

echo "=== 5. Enable auto-renewal ==="
sudo systemctl enable --now certbot-renew.timer 2>/dev/null || true

echo "=== Done! https://$DOMAIN ==="
