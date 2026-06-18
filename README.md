# RecoMind Backend

AI Commerce Visibility Platform — Express.js REST API

---

## Project Structure

```
src/
├── server.js              # Entry point
├── config/
│   ├── db.js              # MongoDB connection
│   ├── redis.js           # Redis connection
│   ├── logger.js          # Winston logger
│   └── swagger.js         # API docs setup
├── middleware/
│   ├── auth.js            # JWT auth + plan gating
│   ├── rateLimiter.js     # Rate limiting
│   └── errorHandler.js    # Global error handler
├── models/
│   ├── Store.model.js          # Shopify store (encrypted tokens)
│   ├── Product.model.js        # Synced Shopify products
│   ├── ProductAnalysis.model.js # AI analysis results + scoring
│   ├── PromptSimulation.model.js # Prompt simulation results
│   └── AuditLog.model.js       # All actions audit trail
├── controllers/
│   ├── auth.controller.js      # Shopify OAuth
│   ├── product.controller.js   # Products + analysis + optimise
│   ├── prompt.controller.js    # Prompt simulation + intelligence
│   ├── report.controller.js    # Reports + llms.txt
│   ├── webhook.controller.js   # Shopify webhook handlers
│   └── admin.controller.js     # Admin panel endpoints
├── routes/
│   ├── auth.routes.js
│   ├── product.routes.js
│   ├── prompt.routes.js
│   ├── report.routes.js
│   ├── webhook.routes.js
│   └── admin.routes.js
├── services/
│   ├── shopify.service.js      # Shopify API + OAuth helpers
│   ├── ai.service.js           # OpenAI prompt engineering + scoring
│   └── productSync.service.js  # Sync + apply optimisations to Shopify
└── jobs/
    ├── analysisQueue.js        # BullMQ queue + enqueue helpers
    └── worker.js               # Worker process entry point
```

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment

```bash
cp .env.example .env
# Fill in all values in .env
```

### 3. Start development

```bash
# API server
npm run dev

# Worker (separate terminal — processes AI jobs)
npm run worker
```

---

## API Endpoints

| Method | Path                          | Auth          | Description               |
| ------ | ----------------------------- | ------------- | ------------------------- |
| GET    | /health                       | —             | Health check              |
| GET    | /api/auth/shopify             | —             | Initiate OAuth            |
| GET    | /api/auth/callback            | —             | OAuth callback            |
| GET    | /api/auth/me                  | JWT           | Current store             |
| POST   | /api/auth/logout              | JWT           | Revoke token              |
| GET    | /api/products                 | JWT           | List products             |
| GET    | /api/products/dashboard       | JWT           | Dashboard stats           |
| POST   | /api/products/sync            | JWT           | Sync from Shopify         |
| POST   | /api/products/analyse-bulk    | JWT           | Bulk AI analysis          |
| GET    | /api/products/:id             | JWT           | Single product + analysis |
| POST   | /api/products/:id/analyse     | JWT           | Queue analysis            |
| GET    | /api/products/:id/analysis    | JWT           | Analysis history          |
| POST   | /api/products/:id/optimise    | JWT           | Push to Shopify           |
| POST   | /api/products/:id/rollback    | JWT           | Roll back version         |
| GET    | /api/products/jobs/:jobId     | JWT           | Job status                |
| POST   | /api/prompts/simulate         | JWT (Growth+) | Prompt simulation         |
| POST   | /api/prompts/analyse          | JWT (Growth+) | Prompt intelligence       |
| GET    | /api/prompts/history          | JWT           | Simulation history        |
| GET    | /api/reports/summary          | JWT           | Full store report         |
| GET    | /api/reports/llms-txt         | JWT           | Download llms.txt         |
| GET    | /api/reports/audit-log        | JWT           | Audit log                 |
| POST   | /api/webhooks/products-create | HMAC          | Shopify webhook           |
| POST   | /api/webhooks/products-update | HMAC          | Shopify webhook           |
| POST   | /api/webhooks/products-delete | HMAC          | Shopify webhook           |
| POST   | /api/webhooks/app-uninstalled | HMAC          | Shopify webhook           |
| GET    | /api/admin/stats              | Admin Key     | Platform stats            |
| GET    | /api/admin/stores             | Admin Key     | All stores                |
| PATCH  | /api/admin/stores/:id/plan    | Admin Key     | Update plan               |
| GET    | /api/admin/audit-log          | Admin Key     | Global audit log          |
| GET    | /api/docs                     | —             | Swagger UI                |

---

## Plan Feature Gating

| Feature                    | Starter | Growth | Agency |
| -------------------------- | ------- | ------ | ------ |
| AI Score + Analyse         | ✅      | ✅     | ✅     |
| Optimise (push to Shopify) | ✅      | ✅     | ✅     |
| Prompt Simulation          | ❌      | ✅     | ✅     |
| Prompt Intelligence        | ❌      | ✅     | ✅     |
| Competitor Gap             | ❌      | ✅     | ✅     |
| White-label Reports        | ❌      | ❌     | ✅     |
| Multi-store                | ❌      | ❌     | ✅     |

---

## Authentication Flow

```
Merchant installs app
  → GET /api/auth/shopify?shop=example.myshopify.com
  → Redirect to Shopify OAuth
  → Shopify redirects to GET /api/auth/callback
  → Backend exchanges code for access token
  → Store created/updated in MongoDB (token AES-encrypted)
  → Webhooks registered
  → Product sync triggered (async)
  → JWT issued → redirect to frontend with ?token=...
```

Frontend stores JWT and sends it as `Authorization: Bearer <token>` on all requests.

---

## Admin Panel Access

All `/api/admin/*` routes require the header:

```
X-Admin-Key: <your ADMIN_SECRET_KEY>
```

---

## Shopify Webhook Registration

After OAuth, these webhooks are auto-registered:

- `products/create` → syncs + auto-analyses new products
- `products/update` → resyncs product data
- `products/delete` → marks product archived
- `app/uninstalled` → marks store inactive

Webhook URL format: `https://your-backend.onrender.com/api/webhooks/products-create`

---

## Deployment (Render)

The `render.yaml` defines two services:

- **RecoMind-api** — web service, runs `node src/server.js`
- **RecoMind-worker** — background worker, runs `node src/jobs/worker.js`

Both need identical environment variables.

---

## Security

- Shopify access tokens are **AES-256 encrypted** at rest
- All webhook payloads are **HMAC verified**
- OAuth uses **CSRF state tokens** stored in Redis
- JWTs are **revocable** via Redis blocklist
- Rate limiting on all routes (stricter on AI endpoints)
- Admin endpoints gated by separate secret key
