/**
 * EdgeFlow - API Playground controller
 *
 * Lets the dashboard send a test request THROUGH EdgeFlow and capture
 * the pipeline stages + response metadata. The frontend uses this to
 * power the built-in Postman-like tester.
 *
 * Internally we just fire the request at our own /gateway/* endpoint
 * via http.request so we can capture timing + status + headers + body
 * without exposing axios to the browser.
 */

const http = require("http");
const { URL } = require("url");
const config = require("../config");
const { ok } = require("../utils/http");
const { generateRequestId } = require("../utils/http");

async function send(req, res, next) {
  try {
    const { method, url, headers = {}, body = null } = req.body;
    if (!method || !url) {
      return res.status(400).json({
        success: false,
        error: {
          code: "BAD_REQUEST",
          message: "method and url are required",
        },
      });
    }
    // The URL must be a path on our own gateway (e.g. /gateway/users/123).
    // We resolve it against the local server.
    const targetPath = url.startsWith("/") ? url : "/" + url;
    const start = process.hrtime.bigint();

    const responsePayload = await new Promise((resolve) => {
      const requestBody =
        body &&
        method.toUpperCase() !== "GET" &&
        method.toUpperCase() !== "HEAD"
          ? typeof body === "string"
            ? body
            : JSON.stringify(body)
          : null;

      const options = {
        method: method.toUpperCase(),
        hostname: "127.0.0.1",
        port: config.server.port,
        path: targetPath,
        headers: {
          "Content-Type": "application/json",
          ...(requestBody
            ? {
                "Content-Length": Buffer.byteLength(requestBody),
              }
            : {}),
          ...headers,
          "X-EdgeFlow-Playground": "true",
          "X-Request-Id": generateRequestId(),
        },
        timeout: config.gateway.requestTimeoutMs,
      };
      const r = http.request(options, (proxyRes) => {
        const chunks = [];
        proxyRes.on("data", (c) => chunks.push(c));
        proxyRes.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf-8");
          let parsedBody;
          try {
            parsedBody = JSON.parse(rawBody);
          } catch {
            parsedBody = rawBody;
          }
          resolve({
            status: proxyRes.statusCode || 0,
            statusText: proxyRes.statusMessage || "",
            headers: proxyRes.headers,
            body: parsedBody,
            bodySize: Buffer.byteLength(rawBody),
          });
        });
      });
      r.on("error", (err) => resolve({ status: 0, error: err.message }));
      r.on("timeout", () => {
        r.destroy();
        resolve({ status: 0, error: "timeout" });
      });
      if (requestBody) {
        r.write(requestBody);
      }
      r.end();
    });

    const latencyMs = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
    return ok(res, {
      ...responsePayload,
      latencyMs,
      request: { method: method.toUpperCase(), url: targetPath, headers, body },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { send };
