/**
 * EdgeFlow - Logs controller
 */

const { queryMany, queryOne } = require("../database/pool");
const { ok, paginate } = require("../utils/http");

async function list(req, res, next) {
  try {
    const limit = Math.min(500, parseInt(req.query.limit, 10) || 50);
    const offset = parseInt(req.query.offset, 10) || 0;
    const serviceId = req.query.serviceId || undefined;
    const statusCode = req.query.statusCode
      ? parseInt(req.query.statusCode, 10)
      : undefined;
    const where = [];
    const values = [];
    if (serviceId) {
      values.push(serviceId);
      where.push(`service_id = $${values.length}`);
    }
    if (statusCode) {
      values.push(statusCode);
      where.push(
        `status_code >= $${values.length} AND status_code < $${values.length + 1}`,
      );
      values.push(statusCode + 100);
    }
    const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    values.push(limit, offset);
    const items = await queryMany(
      `SELECT * FROM request_logs ${whereClause} ORDER BY created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    const total = await queryOne(
      `SELECT COUNT(*)::bigint AS c FROM request_logs ${whereClause}`,
      values.slice(0, -2),
    );
    return ok(
      res,
      items,
      paginate({
        page: Math.floor(offset / limit) + 1,
        limit,
        total: Number(total?.c) || 0,
      }),
    );
  } catch (err) {
    next(err);
  }
}

async function getById(req, res, next) {
  try {
    const r = await queryOne("SELECT * FROM request_logs WHERE id = $1", [
      req.params.id,
    ]);
    if (!r)
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Log not found" },
      });
    return ok(res, r);
  } catch (err) {
    next(err);
  }
}

async function pipeline(req, res, next) {
  try {
    // Return the pipeline_stages for a specific log entry
    const r = await queryOne(
      `SELECT request_id, method, public_path, status_code, latency_ms,cache_hit,pipeline_stages,created_at FROM request_logsWHERE id = $1`,
      [req.params.id],
    );
    if (!r)
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Log not found" },
      });
    return ok(res, r);
  } catch (err) {
    next(err);
  }
}

async function timeline(req, res, next) {
  try {
    // Return recent logs with their pipeline_stages for the timeline view
    const limit = Math.min(50, parseInt(req.query.limit, 10) || 20);
    const items = await queryMany(
      `SELECT id, request_id, method, public_path, status_code, latency_ms,cache_hit, pipeline_stages, created_at
       FROM request_logs WHERE pipeline_stages IS NOT NULL
       ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return ok(res, items);
  } catch (err) {
    next(err);
  }
}

module.exports = { list, getById, pipeline, timeline };
