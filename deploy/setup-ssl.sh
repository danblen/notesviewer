#!/bin/bash
# setup-ssl.sh — Simple, reliable SSL setup via certbot --nginx plugin
# Must run AFTER DNS is confirmed working (nginx already serving HTTP)
set -euo pipefail
DOMAIN="siplgo.xyz"
EMAIL="dan@siplgo.xyz"

CERT_FILE="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"

echo "=== 1. Install nginx + certbot ==="
sudo dnf install -y nginx certbot python3-certbot-nginx

echo "=== 2. Deploy nginx config (HTTP only) ==="
sudo cp /tmp/deploy-notesview/deploy/nginx-notesview.conf /etc/nginx/conf.d/notesview.conf
sudo rm -f /etc/nginx/conf.d/default.conf
sudo systemctl enable --now nginx
sudo nginx -t && sudo systemctl reload nginx

echo "=== 3. Obtain SSL certificate ==="
if [ -f "$CERT_FILE" ]; then
    echo "Cert already exists — running renew"
    sudo certbot renew --quiet || true
else
    echo "Requesting new cert via nginx plugin..."
    # certbot --nginx: uses existing nginx, adds SSL config to notesview.conf
    sudo certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" \
        --non-interactive --agree-tos -m "$EMAIL" \
        --redirect \
        --staple-ocsp \
        2>&1 || echo "certbot failed — staying on HTTP only"
fi

echo "=== 4. Final reload ==="
sudo nginx -t && sudo systemctl reload nginx
echo "=== Done! ==="
