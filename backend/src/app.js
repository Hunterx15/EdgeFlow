/**
 * EdgeFlow - Express app factory
 *
 * Builds the Express app but doesn't listen. server.js does the listening
 * so tests can import the app and supertest-attach to it.
 */

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const compression = require("compression");

const config = require("./config");
const logger = require("./utils/logger");
const {
  requestIdMiddleware,
  responseLogger,
} = require("./middlewares/requestLogger");
const { errorHandler, notFound } = require("./middlewares/errorHandler");
const apiRoutes = require("./routes");
const { proxyMiddleware } = require("./gateway/proxyEngine");
const swaggerSpec = require("./docs/swagger");

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }),
  );
  app.use(
    cors({
      origin: config.server.corsOrigins,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-API-Key",
        "X-Request-Id",
      ],
      exposedHeaders: [
        "X-Request-Id",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-Cache",
        "X-Cache-TTL",
      ],
    }),
  );
  app.use(express.json({ limit: config.server.bodyLimit }));
  app.use(
    express.urlencoded({ extended: true, limit: config.server.bodyLimit }),
  );
  app.use(cookieParser());
  app.use(compression({ threshold: 1024, level: 6 }));

  app.use(requestIdMiddleware);
  app.use(responseLogger);

  app.get("/health", (_req, res) =>
    res.json({
      status: "ok",
      service: "edgeflow",
      timestamp: new Date().toISOString(),
    }),
  );

  try {
    const swaggerUi = require("swagger-ui-express");
    app.use(
      "/api/v1/docs",
      swaggerUi.serve,
      swaggerUi.setup(swaggerSpec, {
        customCss: ".swagger-ui .topbar { background-color: #0f172a; }",
        customSiteTitle: "EdgeFlow API Docs",
      }),
    );
    app.get("/api/v1/openapi.json", (_req, res) => res.json(swaggerSpec));
  } catch (err) {
    logger.warn("app: swagger-ui not available", { error: err.message });
  }

  app.use(config.server.apiPrefix, apiRoutes);
  app.use(config.server.gatewayPrefix, proxyMiddleware);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
