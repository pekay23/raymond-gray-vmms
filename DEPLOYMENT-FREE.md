# VMMS Free-Tier Deployment (No Fly.io)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Cloudflare (Free)                                                           │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │ Pages           │  │ Workers         │  │ R2              │             │
│  │ vmms.raymond-   │  │ api.raymond-    │  │ vmms-evidence   │             │
│  │ gray.org        │  │ gray.org        │  │ bucket          │             │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘             │
│           │                    │                    │                      │
│           │ HTTPS              │ HTTPS              │ S3 API               │
│           ▼                    ▼                    ▼                      │
└───────────┼────────────────────┼────────────────────┼──────────────────────┘
            │                    │                    │
            ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Oracle Cloud Free Tier VM (Always-Free ARM)                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │ Keycloak        │  │ PostgreSQL      │  │ ClamAV          │             │
│  │ auth.raymond-   │  │ (Keycloak DB)   │  │ Scanner         │             │
│  │ gray.org        │  │                 │  │ Port 3310       │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
└─────────────────────────────────────────────────────────────────────────────┘
            │
            │ (VMMS API uses Neon PostgreSQL, not this DB)
            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Neon PostgreSQL (Free Tier)                                                 │
│  vmms database (0.5 GB)                                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Free Tier Limits

| Service | Limit | VMMS Usage |
|---------|-------|------------|
| Cloudflare Pages | Unlimited sites, 500 builds/mo | ✅ |
| Cloudflare Workers | 100k requests/day | ✅ (~10k/day) |
| Cloudflare R2 | 10 GB storage, 1M Class A ops | ✅ |
| Neon PostgreSQL | 0.5 GB storage, unlimited projects | ✅ |
| Oracle Cloud VM | 4 OCPU, 24 GB RAM, 200 GB boot | ✅ (Keycloak + ClamAV) |
| GitHub Actions | 2000 min/mo (public) | ✅ |

---

## One-Time Setup (You Run These)

### 1. Create Accounts
- [ ] Cloudflare (free)
- [ ] Neon (free) → Create project "vmms"
- [ ] Oracle Cloud Free Tier → Create ARM VM (Ubuntu 24.04)
- [ ] GitHub → Create repo `raymond-gray/vmms`

### 2. Neon Database
```bash
# Neon Dashboard → Project "vmms" → Connection Details
# Save BOTH strings:
# Pooled (API):     postgres://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
# Unpooled (migrate): postgres://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
```

### 3. Cloudflare R2
```bash
# Dashboard → R2 → Create bucket "vmms-evidence"
# R2 → Manage API Tokens → Create token:
#   - Name: vmms-app
#   - Permissions: Object Read & Write
#   - Save: Access Key ID, Secret Access Key
#   - Name: vmms-worker
#   - Permissions: Object Read
#   - Save: Access Key ID, Secret Access Key
```

### 4. Oracle VM Setup
```bash
# Oracle Console → Compute → Create Instance
#   - Shape: VM.Standard.A1.Flex (ARM)
#   - OCPUs: 4, Memory: 24 GB
#   - Image: Ubuntu 24.04
#   - SSH Key: Your public key
#   - Network: Allow 22, 80, 443, 8080, 8443, 3310

# On VM:
ssh ubuntu@<vm-public-ip>

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Install compose
sudo apt update && sudo apt install -y docker-compose-plugin

# Copy deployment files
mkdir -p ~/raymond-gray-auth
# From your local machine:
scp docker-compose.oracle.yml setup-oracle-vm.sh ubuntu@<vm-ip>:~/raymond-gray-auth/
scp -r C:/Projects/raymond-gray-auth/themes ubuntu@<vm-ip>:~/raymond-gray-auth/

# On VM:
cd ~/raymond-gray-auth
chmod +x setup-oracle-vm.sh
./setup-oracle-vm.sh

# SAVE THE OUTPUT PASSWORDS!
```

### 5. Cloudflare DNS
```bash
# Dashboard → DNS → Records
# CNAME  auth          → <vm-public-ip> (or use Cloudflare Load Balancer)
# CNAME  vmms          → raymond-gray-vmms.pages.dev (after Pages deploy)
# CNAME  api           → <worker-route> (after Worker deploy)
# 
# SSL/TLS → Overview → Full (strict)
# 
# Get Cloudflare IPs for TRUSTED_PROXY_CIDRS:
curl https://www.cloudflare.com/ips-v4
curl https://www.cloudflare.com/ips-v6
```

### 6. GitHub Secrets (VMMS Repo)
Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
|--------|-------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token (Zone:Read, Pages:Edit, Workers:Edit, R2:Edit) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard right sidebar |
| `DATABASE_URL` | Neon **pooled** connection string |
| `MIGRATION_DATABASE_URL` | Neon **unpooled** connection string |
| `SESSION_SECRET` | `openssl rand -base64 32` |
| `OIDC_ISSUER` | `https://auth.raymond-gray.org/realms/raymond-gray` |
| `OIDC_CLIENT_ID` | `vmms-web-prod` |
| `OIDC_CLIENT_SECRET` | **After Keycloak client creation** |
| `OIDC_CALLBACK_URL` | `https://vmms.raymond-gray.org/api/v1/auth/oidc/callback` |
| `VMMS_EVIDENCE_S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `VMMS_EVIDENCE_S3_BUCKET` | `vmms-evidence` |
| `VMMS_EVIDENCE_S3_REGION` | `auto` |
| `VMMS_EVIDENCE_S3_ACCESS_KEY_ID` | R2 token (app) Access Key ID |
| `VMMS_EVIDENCE_S3_SECRET_ACCESS_KEY` | R2 token (app) Secret Access Key |
| `VMMS_EVIDENCE_WORKER_S3_ACCESS_KEY_ID` | R2 token (worker) Access Key ID |
| `VMMS_EVIDENCE_WORKER_S3_SECRET_ACCESS_KEY` | R2 token (worker) Secret Access Key |
| `VMMS_EVIDENCE_CLAMAV_HOST` | `<oracle-vm-public-ip>` |
| `VMMS_EVIDENCE_CLAMAV_PORT` | `3310` |
| `TRUSTED_PROXY_CIDRS` | Cloudflare IPv4 + IPv6 ranges (comma-separated) |

### 7. Deploy Web (Automatic)
```bash
cd C:\Projects\raymond-gray-vmms
git add .
git commit -m "feat: free-tier deployment configs"
git push origin main
# GitHub Actions → deploy-web.yml runs → deploys to Cloudflare Pages
```

### 8. Configure Cloudflare Pages Custom Domain
- Pages → raymond-gray-vmms → Custom domains
- Add `vmms.raymond-gray.org`
- DNS: CNAME `vmms` → `raymond-gray-vmms.pages.dev` (proxied)

### 9. Deploy API Proxy Worker
```bash
cd C:\Projects\raymond-gray-vmms/apps/web
# Update wrangler.api-proxy.jsonc with actual API origin (Neon doesn't host API)
# For now, use a placeholder - you'll deploy API container separately
wrangler deploy --config wrangler.api-proxy.jsonc --env production
# Or use Cloudflare Dashboard: Workers → Create → Paste api-proxy.ts
```

### 10. Keycloak Realm Setup
```bash
# Access: https://auth.raymond-gray.org/admin
# Login: admin / <KEYCLOAK_ADMIN_PASSWORD from step 4>

# 1. Create Realm: "raymond-gray"
# 2. Realm Settings:
#    - Display Name: "Raymond Gray"
#    - Login Theme: "raymond-gray" (copy theme to VM first)
#    - SSL Required: "all"
#    - WebAuthn RP ID: "auth.raymond-gray.org"
#    - Password Policy: length(12) + upper + lower + digit + special

# 3. Clients → Create:
#    - Client ID: vmms-web-prod
#    - Root URL: https://vmms.raymond-gray.org
#    - Valid Redirect URIs: https://vmms.raymond-gray.org/api/v1/auth/oidc/callback
#    - Web Origins: https://vmms.raymond-gray.org
#    - Access Type: confidential
#    - Save → Copy Secret → GitHub Secret OIDC_CLIENT_SECRET

# 4. Mappers (Client → Mappers):
#    - groups → Group Membership
#    - roles → User Realm Role
```

### 11. Deploy API Container (Choose One)

**Option A: Railway (Free $5/mo credit)**
```bash
# railway.app → New Project → Deploy from GitHub
# Select raymond-gray/vmms → apps/api
# Add all GitHub secrets as Railway variables
# Deploy
```

**Option B: Render (Free tier, spins down)**
```bash
# render.com → New Web Service → Connect GitHub
# Build: docker build -t api .
# Start: node dist/src/server.js
# Add env vars
```

**Option C: Oracle VM (Same VM as Keycloak)**
```bash
# On Oracle VM:
cd ~/raymond-gray-auth
cat > docker-compose.api.yml <<'EOF'
services:
  vmms-api:
    image: ghcr.io/raymond-gray/vmms-api:latest
    restart: unless-stopped
    environment:
      DATABASE_URL: ${DATABASE_URL}
      SESSION_SECRET: ${SESSION_SECRET}
      OIDC_ISSUER: https://auth.raymond-gray.org/realms/raymond-gray
      OIDC_CLIENT_ID: vmms-web-prod
      OIDC_CLIENT_SECRET: ${OIDC_CLIENT_SECRET}
      OIDC_CALLBACK_URL: https://vmms.raymond-gray.org/api/v1/auth/oidc/callback
      VMMS_EVIDENCE_S3_ENDPOINT: ${VMMS_EVIDENCE_S3_ENDPOINT}
      VMMS_EVIDENCE_S3_BUCKET: vmms-evidence
      VMMS_EVIDENCE_S3_REGION: auto
      VMMS_EVIDENCE_S3_ACCESS_KEY_ID: ${VMMS_EVIDENCE_S3_ACCESS_KEY_ID}
      VMMS_EVIDENCE_S3_SECRET_ACCESS_KEY: ${VMMS_EVIDENCE_S3_SECRET_ACCESS_KEY}
      VMMS_EVIDENCE_WORKER_S3_ACCESS_KEY_ID: ${VMMS_EVIDENCE_WORKER_S3_ACCESS_KEY_ID}
      VMMS_EVIDENCE_WORKER_S3_SECRET_ACCESS_KEY: ${VMMS_EVIDENCE_WORKER_S3_SECRET_ACCESS_KEY}
      VMMS_EVIDENCE_CLAMAV_HOST: 127.0.0.1
      VMMS_EVIDENCE_CLAMAV_PORT: 3310
      TRUSTED_PROXY_CIDRS: ${TRUSTED_PROXY_CIDRS}
      NODE_ENV: production
      PORT: 4100
      HOST: 0.0.0.0
    ports:
      - "4100:4100"
    depends_on:
      clamav:
        condition: service_healthy
EOF
# Add env vars to .env, then:
# docker compose -f docker-compose.api.yml up -d
```

### 12. Run Migrations
```bash
# Option A: Railway/Render → Shell → npm run db:migrate
# Option B: Oracle VM:
docker run --rm --network raymond-gray-auth-network \
  -e DATABASE_URL=<neon-unpooled> \
  ghcr.io/raymond-gray/vmms-api:latest npm run db:migrate
```

### 13. Update API Proxy Worker
```bash
# Now that API is deployed, update wrangler.api-proxy.jsonc:
# "vars": { "VMMS_API_ORIGIN": "https://api.raymond-gray.org" }
# Redeploy worker
```

---

## Verification Checklist

| Component | Test | Expected |
|-----------|------|----------|
| Web | `https://vmms.raymond-gray.org` | Sign-in page loads |
| API Health | `https://api.raymond-gray.org/api/v1/health` | `{"status":"ready"}` |
| Keycloak | `https://auth.raymond-gray.org/realms/raymond-gray/.well-known/openid-configuration` | JSON config |
| OIDC Flow | Click "Continue to secure sign-in" on VMMS | Redirects to Keycloak, returns to VMMS |
| Evidence Upload | Work Order → Attach file | 202 Accepted → scan → download |
| ClamAV | `telnet <oracle-ip> 3310` | Connected |

---

## Files in This Repo for Deployment

| File | Purpose |
|------|---------|
| `docker-compose.oracle.yml` | Keycloak + PG + ClamAV on Oracle VM |
| `setup-oracle-vm.sh` | One-shot VM setup script |
| `apps/web/wrangler.production.jsonc` | Cloudflare Pages config |
| `apps/web/wrangler.api-proxy.jsonc` | Worker proxy config |
| `apps/web/src/api-proxy.ts` | Proxy worker code |
| `.github/workflows/deploy-web.yml` | Auto-deploy web to Pages |
| `.github/workflows/build-api.yml` | Build API Docker image to GHCR |
| `DEPLOYMENT.md` | This guide |

---

## Cost: $0/month

All services used have free tiers that cover VMMS needs. No credit card required for Oracle Cloud Free Tier (but may need verification).