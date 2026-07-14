#!/bin/bash
# setup-ssl.sh — Run ONCE on EC2 to get SSL cert and configure nginx
# Idempotent: safe to re-run on every deploy

set -euo pipefail
DOMAIN="siplgo.xyz"
EMAIL="dan@siplgo.xyz"

echo "=== 1. Deploy HTTP nginx config ==="
sudo cp /tmp/deploy-notesview/deploy/nginx-notesview.conf /etc/nginx/conf.d/notesview.conf
sudo rm -f /etc/nginx/conf.d/default.conf

echo "=== 2. Ensure nginx and certbot are installed ==="
sudo dnf install -y nginx certbot python3-certbot-nginx
sudo systemctl enable --now nginx

echo "=== 3. Test and reload nginx ==="
sudo nginx -t && sudo systemctl reload nginx || true

# If SSL cert already exists, use it
if [ -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]; then
  echo "=== SSL certificate exists. Deploying SSL nginx config. ==="
  sudo cp /tmp/deploy-notesview/deploy/nginx-notesview-ssl.conf /etc/nginx/conf.d/notesview.conf
  sudo nginx -t && sudo systemctl reload nginx
  sudo certbot renew --quiet || true
  echo "=== Done! https://$DOMAIN ==="
  exit 0
fi

echo "=== 4. Get SSL certificate via standalone HTTP ===="
sudo systemctl stop nginx

for i in 1 2 3; do
  echo "Attempt $i/3..."
  if sudo certbot certonly --standalone -d "$DOMAIN" -d "www.$DOMAIN" \
    --non-interactive --agree-tos -m "$EMAIL" --preferred-challenges http; then
    echo "=== SSL certificate obtained ==="
    break
  fi
  echo "Attempt $i failed."
  if [ $i -lt 3 ]; then
    echo "Waiting 30s..."
    sleep 30
  fi
done

echo "=== 5. Start nginx with SSL config ==="
if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
  sudo cp /tmp/deploy-notesview/deploy/nginx-notesview-ssl.conf /etc/nginx/conf.d/notesview.conf
else
  echo "=== WARNING: No SSL cert. Using HTTP-only config. ==="
  echo "=== To retry: sudo certbot certonly --standalone -d $DOMAIN -d www.$DOMAIN ==="
fi

sudo systemctl start nginx
sudo nginx -t && sudo systemctl reload nginx

echo "=== 6. Enable auto-renewal ==="
sudo systemctl enable --now certbot-renew.timer 2>/dev/null || true

echo "=== Done! ==="
