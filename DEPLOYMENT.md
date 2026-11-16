# VMMS Free-Tier Deployment Guide
## Deploy to Cloudflare Pages + Fly.io (All Free Tiers)

---

### Prerequisites (One-Time Setup)

1. **Install CLIs**:
```bash
# Fly.io
curl -L https://fly.io/install.sh | sh
fly auth login

# Cloudflare Wrangler
npm install -g wrangler
wrangler login
```

2. **Create GitHub Repo** (if not done):
```bash
cd C:\Projects\raymond-gray-vmms
git init
git add .
git commit -m "Initial commit: VMMS ready for deployment"
gh repo create raymond-gray/vmms --public --source=. --push
# Or create on GitHub.com and push manually
```

3. **Add GitHub Secrets** (Settings → Secrets and variables → Actions):
| Secret | Value |
|--------|-------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token (Zone + Workers + Pages permissions) |
| `CLOUDFLARE_ACCOUNT_ID` | From Cloudflare dashboard sidebar |
| `DATABASE_URL` | Neon / Fly Postgres connection string |
| `MIGRATION_DATABASE_URL` | Same as above (owner role) |
| `SESSION_SECRET` | `openssl rand -base64 32` |
| `OIDC_CLIENT_SECRET` | From Keycloak (after deploy) |
| `OIDC_ISSUER` | `https://auth.raymond-gray.org/realms/raymond-gray` |
| `VMMS_EVIDENCE_S3_ENDPOINT` | `https://<account>.r2.cloudflarestorage.com` |
| `VMMS_EVIDENCE_S3_BUCKET` | `vmms-evidence` |
| `VMMS_EVIDENCE_S3_ACCESS_KEY_ID` | R2 Access Key ID |
| `VMMS_EVIDENCE_S3_SECRET_ACCESS_KEY` | R2 Secret Access Key |
| `VMMS_EVIDENCE_WORKER_S3_ACCESS_KEY_ID` | Worker R2 Access Key |
| `VMMS_EVIDENCE_WORKER_S3_SECRET_ACCESS_KEY` | Worker R2 Secret |
| `VMMS_EVIDENCE_CLAMAV_HOST` | `vmms-clamav.fly.dev` (after Fly deploy) |
| `VMMS_EVIDENCE_CLAMAV_PORT` | `3310` |
| `TRUSTED_PROXY_CIDRS` | Cloudflare ingress IPs (see below) |

---

### Step 1: Deploy ClamAV to Fly.io (Free)

```bash
cd C:\Projects\raymond-gray-vmms

# Create app (no deploy yet)
fly launch --no-deploy --name vmms-clamav --region iad --copy-config fly.clamav.toml

# Create persistent volume for signatures
fly volumes create clamav_data --size 1 --region iad --app vmms-clamav

# Deploy
fly deploy --config fly.clamav.toml

# Verify
fly logs -a vmms-clamav
# Wait for "SelfCheck: Database status OK"
curl https://vmms-clamav.fly.dev:3310  # Should respond
```

**Note**: Fly.io free tier = 3 shared-cpu VMs/month. ClamAV uses 1.

---

### Step 2: Deploy PostgreSQL + Keycloak to Fly.io (Free)

```bash
# Create PostgreSQL (free: 1 shared-cpu, 1GB volume)
fly postgres create --name vmms-auth-db --region iad --vm-size shared-cpu-1x --volume-size 1

# Note the connection string output (save it!)
# Format: postgres://postgres:<password>@vmms-auth-db.internal:5432

# Set DB password as secret (if not auto-set)
fly secrets set KC_DB_PASSWORD=<password> -a vmms-auth-db

# Deploy Keycloak
fly launch --no-deploy --name vmms-keycloak --region iad --copy-config fly.keycloak.toml

# Set Keycloak admin password
fly secrets set KEYCLOAK_ADMIN_PASSWORD=<secure-password> -a vmms-keycloak

# Deploy
fly deploy --config fly.keycloak.toml

# Verify
fly logs -a vmms-keycloak
# Access at https://auth.raymond-gray.org (after DNS)
```

**Configure Keycloak** (via admin console at `https://auth.raymond-gray.org/admin`):
1. Create realm: `raymond-gray`
2. Create client: `vmms-web-prod` (confidential, redirect: `https://vmms.raymond-gray.org/api/v1/auth/oidc/callback`)
3. Copy client secret → GitHub secret `OIDC_CLIENT_SECRET`
4. Create user for testing

---

### Step 3: Deploy API to Fly.io (Free)

```bash
# Create Fly app for API
fly launch --no-deploy --name vmms-api --region iad --dockerfile apps/api/Dockerfile

# Create PostgreSQL for VMMS (separate from auth)
fly postgres create --name vmms-db --region iad --vm-size shared-cpu-1x --volume-size 1

# Attach to API app
fly postgres attach vmms-db --app vmms-api

# Set all secrets (use fly secrets set for each)
fly secrets set DATABASE_URL=... -a vmms-api
fly secrets set MIGRATION_DATABASE_URL=... -a vmms-api
fly secrets set SESSION_SECRET=... -a vmms-api
fly secrets set OIDC_ISSUER=https://auth.raymond-gray.org/realms/raymond-gray -a vmms-api
fly secrets set OIDC_CLIENT_ID=vmms-web-prod -a vmms-api
fly secrets set OIDC_CLIENT_SECRET=... -a vmms-api
fly secrets set OIDC_CALLBACK_URL=https://vmms.raymond-gray.org/api/v1/auth/oidc/callback -a vmms-api
fly secrets set VMMS_EVIDENCE_S3_ENDPOINT=... -a vmms-api
fly secrets set VMMS_EVIDENCE_S3_BUCKET=vmms-evidence -a vmms-api
fly secrets set VMMS_EVIDENCE_S3_ACCESS_KEY_ID=... -a vmms-api
fly secrets set VMMS_EVIDENCE_S3_SECRET_ACCESS_KEY=... -a vmms-api
fly secrets set VMMS_EVIDENCE_WORKER_S3_ACCESS_KEY_ID=... -a vmms-api
fly secrets set VMMS_EVIDENCE_WORKER_S3_SECRET_ACCESS_KEY=... -a vmms-api
fly secrets set VMMS_EVIDENCE_CLAMAV_HOST=vmms-clamav.fly.dev -a vmms-api
fly secrets set VMMS_EVIDENCE_CLAMAV_PORT=3310 -a vmms-api
fly secrets set TRUSTED_PROXY_CIDRS=<cloudflare-ips> -a vmms-api
fly secrets set NODE_ENV=production -a vmms-api
fly secrets set PORT=4100 -a vmms-api
fly secrets set HOST=0.0.0.0 -a vmms-api

# Deploy API
fly deploy --app vmms-api

# Run migrations
fly ssh console --app vmms-api -C "npm run db:migrate"

# Verify
curl https://vmms-api.fly.dev/api/v1/health
```

---

### Step 4: Deploy Web to Cloudflare Pages

**Option A: Via GitHub Actions (Automatic)**
- Push to `main` → workflow deploys automatically
- Check Actions tab for status

**Option B: Manual Deploy**
```bash
cd apps/web
npm run cloudflare:build
wrangler pages deploy dist --project-name=raymond-gray-vmms --branch=main
```

**Configure Custom Domain**:
1. Cloudflare Pages → raymond-gray-vmms → Custom domains
2. Add `vmms.raymond-gray.org`
3. DNS: CNAME `vmms` → `raymond-gray-vmms.pages.dev` (proxied)

---

### Step 5: Deploy API Proxy Worker (Same-Origin)

```bash
cd apps/web
# Update wrangler.api-proxy.jsonc with actual API URL
wrangler deploy --config wrangler.api-proxy.jsonc --env production
```

**Configure DNS**:
- `api.raymond-gray.org` → Worker route (or use Pages Functions)

---

### Step 6: Configure Cloudflare Trusted Proxy CIDRs

Get current Cloudflare IPv4/IPv6 ranges:
```bash
curl https://www.cloudflare.com/ips-v4
curl https://www.cloudflare.com/ips-v6
```

Set as `TRUSTED_PROXY_CIDRS` (comma-separated):
```
173.245.48.0/20,103.21.244.0/22,103.22.200.0/22,103.31.4.0/22,141.101.64.0/18,108.162.192.0/18,190.93.240.0/20,188.114.96.0/20,197.234.240.0/22,198.41.128.0/17,162.158.0.0/15,104.16.0.0/13,104.24.0.0/14,172.64.0.0/13,131.0.72.0/22,2400:cb00::/32,2606:4700::/32,2803:f800::/32,2405:b500::/32,2405:8100::/32,2a06:98c0::/29,2c0f:f248::/32
```

---

### Step 7: Cloudflare R2 for Evidence Storage

```bash
# Create R2 bucket
wrangler r2 bucket create vmms-evidence

# Create API tokens for app and worker
wrangler r2 bucket list
# Use dashboard to create tokens with bucket permissions
```

Add tokens to GitHub secrets and Fly secrets.

---

### Verification Checklist

| Component | URL | Expected |
|-----------|-----|----------|
| Web App | https://vmms.raymond-gray.org | Loads sign-in page |
| API Health | https://vmms-api.fly.dev/api/v1/health | `{"status":"ready"}` |
| Keycloak | https://auth.raymond-gray.org | Admin console |
| ClamAV | (internal) | `fly logs -a vmms-clamav` shows OK |
| Evidence Upload | Web → Work Order → Attach | 202 Accepted → scan → download works |

---

### Free Tier Limits

| Service | Free Tier | VMMS Usage |
|---------|-----------|------------|
| Fly.io | 3 shared-cpu VMs, 3GB volumes | ClamAV (1), Keycloak (1), API (1), PG×2 (2) = **5 VMs** ⚠️ |
| Cloudflare Pages | Unlimited sites, 500 builds/mo | ✅ |
| Cloudflare Workers | 100k req/day | ✅ |
| Cloudflare R2 | 10 GB storage, 1M ops | ✅ |
| Neon PostgreSQL | 0.5 GB storage | ✅ (dev only) |

**Fly.io Limit Fix**: Use **Neon** for PostgreSQL (free 0.5GB) instead of Fly Postgres, or use **Oracle Cloud Free Tier** for Keycloak+Postgres (always-free ARM VM).

---

### Quick Start (Minimal)

If you want **just the web app working** (no evidence, no Keycloak production):

1. **Disable evidence** in `.env`: Don't set S3/ClamAV vars
2. **Use local Keycloak** for auth (docker compose in auth repo)
3. **Deploy only web** to Cloudflare Pages
4. **API runs locally** via `npm run dev:api` with Cloudflare tunnel:
   ```bash
   cloudflared tunnel --url http://localhost:4100
   # Use the https://xxx.trycloudflare.com as VMMS_API_ORIGIN
   ```

This gets you a live frontend at `vmms.raymond-gray.org` talking to your local API.