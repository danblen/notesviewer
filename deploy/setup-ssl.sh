#!/bin/bash
# setup-ssl.sh — Simple, reliable SSL setup via certbot --nginx plugin
# Must run AFTER DNS is confirmed working (nginx already serving HTTP)
set -euo pipefail
DOMAIN="siplgo.xyz"
EMAIL="danblen@gmail.com"
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
    echo "Requesting new cert via standalone mode..."
    # Stop nginx briefly to let certbot bind ports directly
    sudo systemctl stop nginx
    # single attempt — if it fails we stay on HTTP
    if sudo certbot certonly --standalone \
        -d "$DOMAIN" -d "www.$DOMAIN" \
        --non-interactive --agree-tos -m "$EMAIL" \
        --preferred-challenges http; then
        echo "SSL cert obtained!"
        # Now install it into nginx
        if [ -f "$CERT_FILE" ]; then
            sudo certbot install --nginx \
                --cert-name "$DOMAIN" \
                --non-interactive || true
        fi
    else
        echo "certbot failed — site stays on HTTP only"
    fi
    sudo systemctl start nginx
fi

echo "=== 4. Final reload ==="
sudo nginx -t && sudo systemctl reload nginx

echo "=== Done! ==="
echo "=== Check: http://$DOMAIN ==="
[ -f "$CERT_FILE" ] && echo "=== Check: https://$DOMAIN (SSL enabled!) ===" || echo "=== SSL not available yet ==="
