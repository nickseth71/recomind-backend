import swaggerUi from "swagger-ui-express"
import openapiPaths from "./openapi-paths.js"

const serverUrl =
  process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`

function buildSpec() {
  return {
    openapi: "3.0.0",
    info: {
      title: "RecoMind API",
      version: "1.0.0",
      description: `AI Commerce Visibility Platform

## Try it out
1. \`GET /recomind/v1/stores/token?shop=your-store.myshopify.com\` — copy the JWT
2. Click **Authorize** → enter \`Bearer <token>\`
3. Use **Try it out** on any endpoint — all path, query, and body fields are listed below

## Plans (pricing aligned)
| Plan | Price | Products | Prompts/product |
|------|-------|----------|-----------------|
| Starter | $29/mo | 20 | 10 |
| Growth | $99/mo | 100 | 50 |
| Pro | $299/mo | Unlimited | 200 |

Add-ons: Prompt Tracking $19/mo · AI Visibility Audit $149 one-time`,
    },
    servers: [
      { url: serverUrl, description: "Backend server" },
      {
        url: "http://localhost:3000/recomind/v1",
        description: "Local development server",
      },
    ],
    paths: openapiPaths,
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
        AdminKey: {
          type: "apiKey",
          in: "header",
          name: "X-Admin-Key",
        },
      },
      schemas: {
        SuccessResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            data: { type: "object" },
          },
        },
        ErrorResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error: { type: "string" },
          },
        },
      },
    },
    security: [{ BearerAuth: [] }],
    tags: [
      { name: "Stores", description: "Registration, auth, plans" },
      { name: "Products", description: "Sync, analysis, optimize" },
      { name: "Prompts", description: "Prompt Win Dashboard" },
      { name: "Reports", description: "Exports and audit" },
      { name: "Admin", description: "Requires X-Admin-Key header" },
    ],
  }
}

function swaggerSetup(app) {
  const spec = buildSpec()

  app.use(
    `/recomind/v1/docs`,
    swaggerUi.serve,
    swaggerUi.setup(spec, {
      explorer: true,
      persistAuthorization: true,
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        tryItOutEnabled: true,
        filter: true,
        docExpansion: "list",
        defaultModelsExpandDepth: 2,
      },
    }),
  )

  app.get(`/recomind/v1/docs.json`, (req, res) => res.json(spec))
}

export default swaggerSetup
