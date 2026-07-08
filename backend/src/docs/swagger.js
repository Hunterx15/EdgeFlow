/**
 * EdgeFlow - OpenAPI 3 spec (served at /api/v1/docs via swagger-ui-express)
 */

const spec = {
  openapi: "3.0.3",
  info: {
    title: "EdgeFlow API",
    version: "1.0.0",
    description: `
EdgeFlow is a lightweight, production-inspired API Gateway built on Node.js,
Express, PostgreSQL and Redis. It sits in front of multiple backend services
and provides routing, authentication, rate limiting, caching, analytics,
circuit breaking, and a built-in API playground.

## Authentication

Most admin endpoints require a JWT access token obtained via
\`POST /api/v1/auth/login\`. Send it as:

\`\`\`
Authorization: Bearer <accessToken>
\`\`\`

## Gateway Proxy

Backend traffic is forwarded through \`/gateway/<publicPath>\`. The gateway
matches the request against the routes table, applies rate limiting /
caching / circuit breaker, and proxies to the next healthy upstream target.
Each proxied request records its pipeline stages so the dashboard can
visualize the request flow.
    `.trim(),
    license: { name: "MIT" },
  },
  servers: [{ url: "/api/v1", description: "API v1" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      apiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
    },
    schemas: {
      User: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          email: { type: "string", format: "email" },
          name: { type: "string" },
          role: { type: "string" },
          isActive: { type: "boolean" },
        },
      },
      Service: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          slug: { type: "string" },
          basePath: { type: "string" },
          upstreamTargets: {
            type: "array",
            items: {
              type: "object",
              properties: {
                url: { type: "string" },
                weight: { type: "integer" },
                healthy: { type: "boolean" },
              },
            },
          },
          version: { type: "string" },
          enabled: { type: "boolean" },
          lastStatus: {
            type: "string",
            enum: ["healthy", "unhealthy", "unknown"],
          },
        },
      },
      Route: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          serviceId: { type: "string", format: "uuid" },
          method: { type: "string" },
          publicPath: { type: "string" },
          upstreamPath: { type: "string" },
          stripPrefix: { type: "boolean" },
          authRequired: { type: "boolean" },
          apiKeyRequired: { type: "boolean" },
          rateLimitPerMin: { type: "integer" },
          cacheTtlSec: { type: "integer" },
        },
      },
      ApiKey: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          keyId: { type: "string" },
          name: { type: "string" },
          rateLimitPerMin: { type: "integer" },
          enabled: { type: "boolean" },
          plaintextKey: {
            type: "string",
            description: "Only returned on creation",
          },
        },
      },
    },
  },
  paths: {
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Login",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string" },
                  password: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "OK" },
          401: { description: "Unauthorized" },
        },
      },
    },
    "/auth/refresh": {
      post: {
        tags: ["Auth"],
        summary: "Refresh access token",
        responses: {
          200: { description: "OK" },
          401: { description: "Unauthorized" },
        },
      },
    },
    "/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "Current user profile",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "OK" } },
      },
    },
    "/services": {
      get: {
        tags: ["Services"],
        summary: "List services",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "OK" } },
      },
      post: {
        tags: ["Services"],
        summary: "Register service",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Service" },
            },
          },
        },
        responses: { 201: { description: "Created" } },
      },
    },
    "/routes": {
      get: {
        tags: ["Routes"],
        summary: "List routes",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "OK" } },
      },
      post: {
        tags: ["Routes"],
        summary: "Register route",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Route" },
            },
          },
        },
        responses: { 201: { description: "Created" } },
      },
    },
    "/api-keys": {
      get: {
        tags: ["API Keys"],
        summary: "List API keys",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "OK" } },
      },
      post: {
        tags: ["API Keys"],
        summary: "Issue API key",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: {
                    type: "string",
                    example: "Frontend Key",
                  },
                  scopes: {
                    type: "array",
                    items: {
                      type: "string",
                    },
                    example: ["read"],
                  },
                  rateLimitPerMin: {
                    type: "integer",
                    example: 100,
                  },
                  expiresAt: {
                    type: "string",
                    format: "date-time",
                    nullable: true,
                    example: "2027-01-01T00:00:00Z",
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: "Created - plaintext shown once",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ApiKey",
                },
              },
            },
          },
        },
      },
    },
    "/dashboard/overview": {
      get: {
        tags: ["Dashboard"],
        summary: "Dashboard overview",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "OK" } },
      },
    },
    "/dashboard/live-metrics": {
      get: {
        tags: ["Dashboard"],
        summary: "Live metrics (RPS, P95, active, uptime)",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "OK" } },
      },
    },
    "/analytics/per-minute": {
      get: {
        tags: ["Analytics"],
        summary: "Per-minute rollups",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "OK" } },
      },
    },
    "/logs": {
      get: {
        tags: ["Logs"],
        summary: "List request logs",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "OK" } },
      },
    },
    "/logs/timeline": {
      get: {
        tags: ["Logs"],
        summary: "Recent logs with pipeline stages",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "OK" } },
      },
    },
    "/monitoring/live": {
      get: {
        tags: ["Monitoring"],
        summary: "Liveness probe",
        responses: { 200: { description: "OK" } },
      },
    },
    "/monitoring/ready": {
      get: {
        tags: ["Monitoring"],
        summary: "Readiness probe",
        responses: {
          200: { description: "OK" },
          503: { description: "Not ready" },
        },
      },
    },
    "/monitoring/dependency-graph": {
      get: {
        tags: ["Monitoring"],
        summary: "Service dependency graph",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "OK" } },
      },
    },
    "/monitoring/circuit-breakers": {
      get: {
        tags: ["Monitoring"],
        summary: "Circuit breaker states",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "OK" } },
      },
    },
    "/playground/send": {
      post: {
        tags: ["Playground"],
        summary: "Send a test request through the gateway",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  method: { type: "string" },
                  url: { type: "string" },
                  headers: { type: "object" },
                  body: { type: "string" },
                },
              },
            },
          },
        },
        responses: { 200: { description: "OK" } },
      },
    },
  },
};

module.exports = spec;
