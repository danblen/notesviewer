#!/bin/bash
# setup-ssl.sh — Simple, reliable SSL setup
# Works even when nginx is already running on port 80
set -euo pipefail
DOMAIN="siplgo.xyz"
EMAIL="danblen@gmail.com"
CERT_FILE="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"

echo "=== 1. Install packages ==="
sudo dnf install -y nginx certbot python3-certbot-nginx

echo "=== 2. Deploy nginx config (HTTP only) ==="
sudo cp /tmp/deploy-notesview/deploy/nginx-notesview.conf /etc/nginx/conf.d/notesview.conf
sudo rm -f /etc/nginx/conf.d/default.conf
sudo systemctl enable --now nginx
sudo nginx -t && sudo systemctl reload nginx

echo "=== 3. Obtain SSL certificate ==="
if [ -f "$CERT_FILE" ]; then
    echo "Cert already exists — running renew..."
    sudo certbot renew --quiet || true
    exit 0
fi

# certbot --nginx uses the running nginx to serve the ACME challenge.
# It reads nginx config, adds the cert, and rewrites for HTTPS.
echo "Requesting new cert with --nginx plugin..."
if sudo certbot --nginx \
    -d "$DOMAIN" -d "www.$DOMAIN" \
    --non-interactive --agree-tos -m "$EMAIL" \
    --keep-until-expiring --expand; then
    echo "=== SSL obtained! ==="
else
    echo "=== certbot failed. Site stays on HTTP. ==="
    echo "=== To debug: sudo systemctl status nginx ==="
    echo "=== To retry: sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN ==="
fi

echo "=== 4. Final reload ==="
sudo nginx -t && sudo systemctl reload nginx

echo "=== Status ==="
echo "HTTP:  http://$DOMAIN"
if [ -f "$CERT_FILE" ]; then
    echo "HTTPS: https://$DOMAIN (SSL active!)"
else
    echo "HTTPS: not yet — will retry on next deploy"
fi
