#!/bin/bash
# setup-ssl.sh — Reliable SSL setup
set -euo pipefail
DOMAIN="siplgo.xyz"
EMAIL="danblen@gmail.com"
CERTFILE="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"

echo "=== 1. Install packages ==="
sudo dnf install -y nginx certbot python3-certbot-nginx

echo "=== 2. Deploy nginx config ==="
sudo cp /tmp/deploy-notesview/deploy/nginx-notesview.conf /etc/nginx/conf.d/notesview.conf
sudo rm -f /etc/nginx/conf.d/default.conf
sudo systemctl enable --now nginx
sudo nginx -t && sudo systemctl reload nginx

echo "=== 3. Certbot ==="
# Always try certbot -- it is idempotent
# If cert exists, it refreshes. If not, it creates.
# Falls back gracefully if it fails.
if sudo certbot --nginx \
    -d "$DOMAIN" -d "www.$DOMAIN" \
    --non-interactive --agree-tos -m "$EMAIL" \
    --eff-email 2>&1; then
    echo "certbot SUCCESS"
else
    echo "certbot FAILED"
    echo "If this is a rate-limit error, wait 1 hour and redeploy."
    echo "To debug manually: ssh ec2-user@$DOMAIN"
    echo "  sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN"
fi

echo "=== 4. Reload nginx ==="
sudo nginx -t && sudo systemctl reload nginx

echo "=== 5. Status ==="
[ -f "$CERTFILE" ] && echo "SSL: ACTIVE (https://$DOMAIN)" || echo "SSL: NOT ACTIVE (http://$DOMAIN)"
