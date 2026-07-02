/**
 * Complete OpenAPI path definitions (avoids JSDoc YAML `#` comment bugs).
 */

const bearer = [{ BearerAuth: [] }]
const adminSec = [{ AdminKey: [] }]

const idPath = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "MongoDB product ID",
  example: "665a1b2c3d4e5f6789012345",
}

const productIdPath = {
  name: "productId",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "MongoDB product ID",
  example: "665a1b2c3d4e5f6789012345",
}

const promptIdPath = {
  name: "promptId",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "MongoDB ProductPrompt ID",
  example: "665a1b2c3d4e5f6789012346",
}

const jobIdPath = {
  name: "jobId",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "BullMQ job ID returned from analyse endpoint",
  example: "12345",
}

const storeIdPath = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "MongoDB store ID",
}

const jsonBody = (schema, required = false) => ({
  required,
  content: { "application/json": { schema } },
})

const ok = (description) => ({
  200: {
    description,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/SuccessResponse" },
      },
    },
  },
})

const openapiPaths = {
  "/stores": {
    post: {
      tags: ["Stores"],
      summary: "Register or update store (afterAuth hook)",
      security: [],
      requestBody: jsonBody(
        {
          type: "object",
          required: ["shop", "accessToken"],
          properties: {
            shop: { type: "string", example: "example.myshopify.com" },
            accessToken: { type: "string", example: "shpat_xxxxxxxx" },
            scope: { type: "string", example: "read_products,write_products" },
          },
        },
        true,
      ),
      responses: {
        200: { description: "Store saved, JWT returned" },
        400: { description: "Missing shop or accessToken" },
      },
    },
  },

  "/stores/me": {
    get: {
      tags: ["Stores"],
      summary: "Get current store profile, plan limits, and token quota",
      security: bearer,
      responses: ok("Store profile"),
    },
  },

  "/stores/me/settings": {
    patch: {
      tags: ["Stores"],
      summary: "Update store settings",
      security: bearer,
      requestBody: jsonBody({
        type: "object",
        properties: {
          faqStrategy: {
            type: "string",
            enum: ["auto", "inline", "metafield"],
            description: "How FAQs are stored when optimizing products",
          },
        },
      }),
      responses: ok("Settings updated"),
    },
  },

  "/stores/plans": {
    get: {
      tags: ["Stores"],
      summary: "List all billing plans and add-ons (pricing page)",
      security: [],
      responses: ok("Plans and add-ons"),
    },
  },

  "/stores/token": {
    get: {
      tags: ["Stores"],
      summary: "Get JWT for a shop domain",
      security: [],
      parameters: [
        {
          name: "shop",
          in: "query",
          required: true,
          schema: { type: "string" },
          example: "example.myshopify.com",
          description: "Shopify shop domain",
        },
      ],
      responses: {
        200: { description: "JWT token" },
        400: { description: "Missing shop param" },
        404: { description: "Store not found" },
      },
    },
  },

  "/products/dashboard": {
    get: {
      tags: ["Products"],
      summary: "Dashboard stats + Prompt Win summary",
      security: bearer,
      parameters: [
        {
          name: "timePeriod",
          in: "query",
          schema: {
            type: "string",
            enum: ["30days", "30d", "3months", "3m", "6months", "6m"],
            default: "30days",
          },
        },
      ],
      responses: ok("Dashboard data"),
    },
  },

  "/products": {
    get: {
      tags: ["Products"],
      summary: "List products (paginated)",
      security: bearer,
      parameters: [
        { name: "page", in: "query", schema: { type: "integer", default: 1 } },
        {
          name: "limit",
          in: "query",
          schema: { type: "integer", default: 20 },
        },
        {
          name: "sort",
          in: "query",
          schema: { type: "string", enum: ["score_asc", "score_desc"] },
        },
        {
          name: "optimized",
          in: "query",
          schema: { type: "boolean" },
          description: "Filter by isOptimized",
        },
        {
          name: "status",
          in: "query",
          schema: { type: "string", enum: ["active", "draft", "archived"] },
        },
      ],
      responses: ok("Product list"),
    },
  },

  "/products/sync": {
    post: {
      tags: ["Products"],
      summary: "Manual Shopify product sync",
      security: bearer,
      responses: ok("Sync started/completed"),
    },
  },

  "/products/analyse-bulk": {
    post: {
      tags: ["Products"],
      summary: "Enqueue all un-analysed products (Pro: bulk optimize scale)",
      security: bearer,
      responses: ok("Bulk jobs queued"),
    },
  },

  "/products/jobs/{jobId}": {
    get: {
      tags: ["Products"],
      summary: "Check analysis job status",
      security: bearer,
      parameters: [jobIdPath],
      responses: ok("Job status"),
    },
  },

  "/products/{id}": {
    get: {
      tags: ["Products"],
      summary: "Get product with latest analysis and FAQ info",
      security: bearer,
      parameters: [idPath],
      responses: ok("Product + analysis"),
    },
  },

  "/products/{id}/analyse": {
    post: {
      tags: ["Products"],
      summary: "Queue AI analysis for one product",
      security: bearer,
      parameters: [idPath],
      responses: {
        200: { description: "Job queued or cached analysis returned" },
        429: { description: "Plan product limit or token quota exceeded" },
      },
    },
  },

  "/products/{id}/analysis": {
    get: {
      tags: ["Products"],
      summary: "Analysis version history (last 10)",
      security: bearer,
      parameters: [idPath],
      responses: ok("Analysis versions"),
    },
  },

  "/products/{id}/competitors": {
    get: {
      tags: ["Products"],
      summary: "Get product competitor benchmark for this plan",
      security: bearer,
      parameters: [idPath],
      responses: {
        200: {
          description: "Competitor benchmark data",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  success: { type: "boolean", example: true },
                  data: {
                    type: "object",
                    properties: {
                      enabled: { type: "boolean", example: true },
                      competitorCount: { type: "integer", example: 3 },
                      competitorBenchmark: {
                        type: ["object", "null"],
                        description:
                          "Benchmark table returned only when competitor analysis is enabled",
                      },
                      plan: { type: "string", example: "growth" },
                    },
                  },
                },
              },
            },
          },
        },
        404: { description: "Product or analysis not found" },
      },
    },
  },

  "/products/{id}/optimise": {
    post: {
      tags: ["Products"],
      summary: "Apply latest analysis to Shopify",
      security: bearer,
      parameters: [idPath],
      requestBody: jsonBody({
        type: "object",
        properties: {
          faqStrategy: {
            type: "string",
            enum: ["auto", "inline", "metafield", "skip"],
            description: "How to apply FAQs",
          },
          faqs: {
            type: "array",
            items: {
              type: "object",
              required: ["question", "answer"],
              properties: {
                question: { type: "string", example: "Is this lactose-free?" },
                answer: {
                  type: "string",
                  example: "Yes, it contains no lactose.",
                },
              },
            },
          },
          promptId: {
            type: "string",
            description: "Fix for a specific prompt (Growth+)",
          },
        },
      }),
      responses: {
        200: { description: "Optimized on Shopify" },
        400: { description: "No analysis found" },
      },
    },
  },

  "/products/{id}/rollback": {
    post: {
      tags: ["Products"],
      summary: "Rollback to a previous analysis version",
      security: bearer,
      parameters: [idPath],
      requestBody: jsonBody(
        {
          type: "object",
          required: ["analysisId"],
          properties: {
            analysisId: {
              type: "string",
              description: "Analysis version _id to restore",
              example: "665a1b2c3d4e5f6789012347",
            },
            faqStrategy: {
              type: "string",
              enum: ["auto", "inline", "metafield", "skip"],
            },
          },
        },
        true,
      ),
      responses: ok("Rolled back"),
    },
  },

  "/prompts/win-dashboard": {
    get: {
      tags: ["Prompts"],
      summary: "Prompt Win Dashboard — Win / Improve / Missing",
      security: bearer,
      parameters: [
        {
          name: "productId",
          in: "query",
          schema: { type: "string" },
          description: "Optional filter by product",
        },
      ],
      responses: ok("Prompt win summary"),
    },
  },

  "/prompts/history": {
    get: {
      tags: ["Prompts"],
      summary: "Prompt simulation history",
      security: bearer,
      parameters: [
        { name: "page", in: "query", schema: { type: "integer", default: 1 } },
        {
          name: "limit",
          in: "query",
          schema: { type: "integer", default: 20 },
        },
      ],
      responses: ok("Simulation history"),
    },
  },

  "/prompts/score": {
    post: {
      tags: ["Prompts"],
      summary: "Score one prompt against a product",
      security: bearer,
      requestBody: jsonBody(
        {
          type: "object",
          required: ["prompt", "productId"],
          properties: {
            prompt: {
              type: "string",
              example: "low bloating whey protein",
            },
            productId: { type: "string", example: "665a1b2c3d4e5f6789012345" },
          },
        },
        true,
      ),
      responses: ok("Visibility score"),
    },
  },

  "/prompts/simulate": {
    post: {
      tags: ["Prompts"],
      summary: "AI recommendation simulation (Growth+)",
      security: bearer,
      requestBody: jsonBody(
        {
          type: "object",
          required: ["prompt", "productId"],
          properties: {
            prompt: {
              type: "string",
              example: "best protein powder for beginners under $60",
            },
            productId: { type: "string" },
          },
        },
        true,
      ),
      responses: {
        200: { description: "Simulation result" },
        403: { description: "Requires Growth plan" },
      },
    },
  },

  "/prompts/analyse": {
    post: {
      tags: ["Prompts"],
      summary: "Prompt Intelligence — what it takes to win a query (Growth+)",
      security: bearer,
      requestBody: jsonBody(
        {
          type: "object",
          required: ["prompt"],
          properties: {
            prompt: {
              type: "string",
              example: "best whey protein for lactose sensitive",
            },
          },
        },
        true,
      ),
      responses: ok("Intelligence analysis"),
    },
  },

  "/prompts/products/{productId}": {
    get: {
      tags: ["Prompts"],
      summary: "List scored prompts for a product",
      security: bearer,
      parameters: [
        productIdPath,
        {
          name: "visibility",
          in: "query",
          schema: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
        },
      ],
      responses: ok("Product prompts"),
    },
  },

  "/prompts/products/{productId}/generate": {
    post: {
      tags: ["Prompts"],
      summary: "Generate and score prompts for a product",
      security: bearer,
      parameters: [productIdPath],
      requestBody: jsonBody({
        type: "object",
        properties: {
          prompts: {
            type: "array",
            items: { type: "string" },
            example: ["best protein for beginners", "low bloating whey"],
            description: "Optional custom prompts (otherwise auto-generated)",
          },
        },
      }),
      responses: ok("Scored prompts"),
    },
  },

  "/prompts/{promptId}/fix": {
    get: {
      tags: ["Prompts"],
      summary: "Fix details for a prompt — missing signals + actions (Growth+)",
      security: bearer,
      parameters: [promptIdPath],
      responses: ok("Fix recommendations"),
    },
  },

  "/reports/summary": {
    get: {
      tags: ["Reports"],
      summary: "Full AI visibility summary report",
      security: bearer,
      responses: ok("Store report"),
    },
  },

  "/reports/llms-txt": {
    get: {
      tags: ["Reports"],
      summary: "Download generated llms.txt",
      security: bearer,
      responses: {
        200: { description: "Markdown file download" },
      },
    },
  },

  "/reports/audit-log": {
    get: {
      tags: ["Reports"],
      summary: "Store audit log",
      security: bearer,
      parameters: [
        { name: "page", in: "query", schema: { type: "integer", default: 1 } },
        {
          name: "limit",
          in: "query",
          schema: { type: "integer", default: 30 },
        },
        { name: "action", in: "query", schema: { type: "string" } },
      ],
      responses: ok("Audit log entries"),
    },
  },

  "/admin/stats": {
    get: {
      tags: ["Admin"],
      summary: "Platform-wide statistics",
      security: adminSec,
      responses: ok("Platform stats"),
    },
  },

  "/admin/stores": {
    get: {
      tags: ["Admin"],
      summary: "List stores",
      security: adminSec,
      parameters: [
        { name: "page", in: "query", schema: { type: "integer", default: 1 } },
        {
          name: "limit",
          in: "query",
          schema: { type: "integer", default: 20 },
        },
        {
          name: "plan",
          in: "query",
          schema: {
            type: "string",
            enum: ["starter", "growth", "pro", "agency"],
          },
        },
        { name: "active", in: "query", schema: { type: "boolean" } },
        { name: "search", in: "query", schema: { type: "string" } },
      ],
      responses: ok("Store list"),
    },
  },

  "/admin/stores/{id}/plan": {
    patch: {
      tags: ["Admin"],
      summary: "Update store plan or add-ons",
      security: adminSec,
      parameters: [storeIdPath],
      requestBody: jsonBody(
        {
          type: "object",
          required: ["plan"],
          properties: {
            plan: {
              type: "string",
              enum: ["starter", "growth", "pro", "agency"],
              example: "growth",
            },
            planExpiresAt: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            addons: {
              type: "object",
              properties: {
                promptTracking: { type: "boolean" },
                aiVisibilityAudit: { type: "boolean" },
              },
            },
          },
        },
        true,
      ),
      responses: ok("Plan updated"),
    },
  },

  "/admin/audit-log": {
    get: {
      tags: ["Admin"],
      summary: "Global audit log",
      security: adminSec,
      parameters: [
        { name: "page", in: "query", schema: { type: "integer", default: 1 } },
        {
          name: "limit",
          in: "query",
          schema: { type: "integer", default: 30 },
        },
        { name: "action", in: "query", schema: { type: "string" } },
        { name: "storeId", in: "query", schema: { type: "string" } },
      ],
      responses: ok("Audit log"),
    },
  },
}

export default openapiPaths
