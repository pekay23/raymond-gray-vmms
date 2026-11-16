# Oracle VM Setup Script
# Run on Oracle VM after docker-compose.oracle.yml is in place

#!/bin/bash
set -euo pipefail

# =============================================================================
# CONFIGURATION — EDIT THESE
# =============================================================================
KC_DB_PASSWORD="$(openssl rand -base64 32)"
KEYCLOAK_ADMIN_PASSWORD="$(openssl rand -base64 32)"

echo "Generated passwords (SAVE THESE):"
echo "KC_DB_PASSWORD=$KC_DB_PASSWORD"
echo "KEYCLOAK_ADMIN_PASSWORD=$KEYCLOAK_ADMIN_PASSWORD"
echo ""

# =============================================================================
# CREATE .env FILE FOR DOCKER COMPOSE
# =============================================================================
cat > .env <<EOF
KC_DB_PASSWORD=$KC_DB_PASSWORD
KEYCLOAK_ADMIN_PASSWORD=$KEYCLOAK_ADMIN_PASSWORD
EOF

# =============================================================================
# COPY RAYMOND GRAY THEME FROM LOCAL REPO
# =============================================================================
# Assumes you have the auth repo locally and can scp it
# From your local machine:
#   scp -r C:/Projects/raymond-gray-auth/themes ubuntu@<vm-ip>:~/raymond-gray-auth/
#
# Or clone the auth repo on the VM:
#   git clone https://github.com/raymond-gray/auth.git ~/raymond-gray-auth-temp
#   cp -r ~/raymond-gray-auth-temp/themes ~/raymond-gray-auth/
#   rm -rf ~/raymond-gray-auth-temp

if [ ! -d "themes/raymond-gray" ]; then
    echo "⚠️  Theme not found. Copy from local:"
    echo "   scp -r /path/to/raymond-gray-auth/themes ubuntu@\$(hostname -I | awk '{print \$1}'):~/raymond-gray-auth/"
    echo "   Or clone the auth repo and copy themes/"
    exit 1
fi

# =============================================================================
# START SERVICES
# =============================================================================
echo "Starting Keycloak + PostgreSQL + ClamAV..."
docker compose -f docker-compose.oracle.yml up -d

# =============================================================================
# WAIT FOR HEALTH
# =============================================================================
echo "Waiting for services to be healthy..."
sleep 30

for i in {1..20}; do
    if docker compose -f docker-compose.oracle.yml ps | grep -q "healthy"; then
        echo "Services healthy!"
        break
    fi
    echo "Waiting... ($i/20)"
    sleep 15
done

# =============================================================================
# VERIFY
# =============================================================================
echo ""
echo "=== VERIFICATION ==="
echo "Keycloak:  http://<vm-public-ip> (port 80)"
echo "Admin:     http://<vm-public-ip>/admin"
echo "  User:    admin"
echo "  Pass:    $KEYCLOAK_ADMIN_PASSWORD"
echo ""
echo "ClamAV:    tcp://<vm-public-ip>:3310"
echo ""
echo "SAVE THESE CREDENTIALS SECURELY!"
echo "KC_DB_PASSWORD=$KC_DB_PASSWORD"
echo "KEYCLOAK_ADMIN_PASSWORD=$KEYCLOAK_ADMIN_PASSWORD"