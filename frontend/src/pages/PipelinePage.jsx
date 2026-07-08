/**
 * EdgeFlow - Request Pipeline Visualization page
 *
 * Animated page that shows the 9-stage request flow:
 *   Client → JWT Auth → Rate Limiter → Redis Cache → Circuit Breaker
 *   → Load Balancer → Reverse Proxy → Microservice → Response
 *
 * Pulls recent logs from /api/v1/logs/timeline (each log has its
 * pipeline_stages array). Selecting a log animates through each stage
 * showing its name, description, time taken, status, and cache hit/miss.
 */

import React, { useEffect, useState, useCallback } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Zap,
} from "lucide-react";
import { logsApi } from "../api/endpoints";
import Card from "../components/ui/Card";
import EmptyState from "../components/ui/EmptyState";
import {
  classNames,
  formatMs,
  formatRelative,
  statusCodeBadge,
} from "../utils/format";

// Static pipeline stage definitions - the order matters and mirrors
// the proxyEngine.js stage() execution order.
const PIPELINE_STAGES = [
  {
    key: "Route Lookup",
    icon: "🔍",
    description:
      "Match incoming URL against the routes table (in-memory cache)",
  },
  {
    key: "Service Load",
    icon: "📦",
    description:
      "Fetch the target service + its upstream targets from PostgreSQL",
  },
  {
    key: "API Key Auth",
    icon: "🔑",
    description:
      "Validate X-API-Key header against the api_keys table (if route requires it)",
  },
  {
    key: "Rate Limit",
    icon: "🚦",
    description:
      "Sliding-window counter in Redis - rejects bursts over the per-minute limit",
  },
  {
    key: "Cache Lookup",
    icon: "⚡",
    description: "GET-only Redis cache check - returns cached response on HIT",
  },
  {
    key: "Load Balancer",
    icon: "⚖️",
    description: "Weighted round-robin picks the next healthy upstream target",
  },
  {
    key: "Circuit Breaker",
    icon: "🔌",
    description: "Skip if OPEN, probe if HALF_OPEN, allow if CLOSED",
  },
  {
    key: "Path Rewrite",
    icon: "✂️",
    description: "Strip gateway prefix + apply upstream_path template",
  },
  {
    key: "Reverse Proxy",
    icon: "🔄",
    description: "Forward via http-proxy with timeout + retry-once",
  },
  {
    key: "Response",
    icon: "✅",
    description: "Record log + analytics + return response to client",
  },
];

export default function PipelinePage() {
  const [logs, setLogs] = useState([]);
  const [selectedLog, setSelectedLog] = useState(null);
  const [activeStageIdx, setActiveStageIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await logsApi.timeline(30);
      setLogs(data);
      if (data.length > 0 && !selectedLog) setSelectedLog(data[0]);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [selectedLog]);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  // Animate through stages when a log is selected or playing
  useEffect(() => {
    if (!selectedLog || !playing) return;
    setActiveStageIdx(-1);
    let idx = -1;
    const id = setInterval(() => {
      idx += 1;
      if (idx >= PIPELINE_STAGES.length) {
        clearInterval(id);
        setPlaying(false);
        setActiveStageIdx(PIPELINE_STAGES.length - 1);
        return;
      }
      setActiveStageIdx(idx);
    }, 800);
    return () => clearInterval(id);
  }, [selectedLog, playing]);

  const selectLog = (log) => {
    setSelectedLog(log);
    setPlaying(false);
    setActiveStageIdx(-1);
  };
  const play = () => {
    if (!selectedLog) return;
    setPlaying(true);
  };
  const pause = () => setPlaying(false);
  const reset = () => {
    setPlaying(false);
    setActiveStageIdx(-1);
  };

  // Build a map of stage name -> actual stage data from the selected log
  const stageMap = new Map();
  if (selectedLog?.pipeline_stages) {
    try {
      const stages =
        typeof selectedLog.pipeline_stages === "string"
          ? JSON.parse(selectedLog.pipeline_stages)
          : selectedLog.pipeline_stages;
      stages.forEach((s) => stageMap.set(s.name, s));
    } catch {}
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">
            Request Pipeline Visualizer
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Watch a request flow through every gateway stage with real timings.
          </p>
        </div>
        <div className="flex gap-2">
          {!playing ? (
            <button
              onClick={play}
              disabled={!selectedLog}
              className="btn-primary"
            >
              <Play size={14} /> Play
            </button>
          ) : (
            <button onClick={pause} className="btn-secondary">
              <Pause size={14} /> Pause
            </button>
          )}
          <button onClick={reset} className="btn-secondary">
            <RotateCcw size={14} /> Reset
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Log picker */}
        <Card
          title="Recent Requests"
          subtitle="Pick a request to visualize"
          bodyClassName="p-0"
        >
          <div className="max-h-[500px] overflow-y-auto">
            {loading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="skeleton h-12 w-full" />
                ))}
              </div>
            ) : logs.length === 0 ? (
              <EmptyState
                icon={Zap}
                title="No pipeline data"
                description="Send a few requests through the gateway to see them here."
              />
            ) : (
              logs.map((log) => (
                <button
                  key={log.id}
                  onClick={() => selectLog(log)}
                  className={classNames(
                    "w-full text-left px-3 py-2 border-b border-slate-800/40 hover:bg-slate-800/30 transition",
                    selectedLog?.id === log.id &&
                      "bg-brand-500/10 border-l-2 border-l-brand-500",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-slate-300">
                      {log.method}
                    </span>
                    <span
                      className={classNames(
                        "badge",
                        `badge-${statusCodeBadge(log.status_code)}`,
                      )}
                    >
                      {log.status_code}
                    </span>
                  </div>
                  <div className="text-xs font-mono text-slate-500 truncate mt-0.5">
                    {log.public_path}
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-600 mt-1">
                    <span>{formatRelative(log.created_at)}</span>
                    <span>{formatMs(log.latency_ms)}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </Card>

        {/* Pipeline visualization */}
        <div className="lg:col-span-2">
          <Card
            title={
              selectedLog
                ? `Pipeline: ${selectedLog.method} ${selectedLog.public_path}`
                : "Pipeline"
            }
            subtitle={
              selectedLog
                ? `Request ID: ${selectedLog.request_id} · Total: ${formatMs(selectedLog.latency_ms)}`
                : "Select a request to begin"
            }
          >
            <div className="space-y-3">
              {/* Stage rows */}
              {PIPELINE_STAGES.map((stage, idx) => {
                const actual = stageMap.get(stage.key);

                const cacheHit =
                  selectedLog?.cache_hit && stage.key === "Cache Lookup";

                const skippedAfterCache =
                  selectedLog?.cache_hit &&
                  !actual &&
                  [
                    "Load Balancer",
                    "Circuit Breaker",
                    "Path Rewrite",
                    "Reverse Proxy",
                  ].includes(stage.key);
                const isPast = activeStageIdx >= idx;
                const isActive = activeStageIdx === idx;
                const stageOk = skippedAfterCache
                  ? true
                  : actual
                    ? actual.ok
                    : isPast;
                return (
                  <div
                    key={stage.key}
                    className={classNames(
                      "flex items-start gap-3 p-3 rounded-lg border transition-all duration-300",
                      isActive
                        ? "border-brand-500 bg-brand-500/10 scale-[1.02] shadow-lg shadow-brand-500/20"
                        : "border-slate-800 bg-slate-900/40",
                      isPast && !isActive && "border-slate-700",
                    )}
                  >
                    {/* Icon */}
                    <div
                      className={classNames(
                        "w-10 h-10 rounded-lg flex items-center justify-center text-xl shrink-0 transition-all",
                        isActive
                          ? "bg-brand-500/30 animate-pulse"
                          : isPast
                            ? "bg-slate-800"
                            : "bg-slate-800/50 opacity-50",
                      )}
                    >
                      {skippedAfterCache ? (
                        <span className="text-slate-400">⏭️</span>
                      ) : actual && !actual.ok ? (
                        <XCircle size={18} className="text-rose-400" />
                      ) : isPast ? (
                        <CheckCircle2 size={18} className="text-brand-400" />
                      ) : isActive ? (
                        <Loader2
                          size={18}
                          className="text-brand-300 animate-spin"
                        />
                      ) : (
                        <span>{stage.icon}</span>
                      )}
                    </div>
                    {/* Text */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div
                          className={classNames(
                            "text-sm font-medium",
                            isPast || isActive
                              ? "text-slate-100"
                              : "text-slate-500",
                          )}
                        >
                          {idx + 1}. {stage.key}
                        </div>
                        {actual && (
                          <div className="flex items-center gap-2 text-xs">
                            {actual.result &&
                              typeof actual.result === "string" && (
                                <span className="badge-neutral">
                                  {actual.result}
                                </span>
                              )}
                            <span className="text-slate-400 flex items-center gap-1">
                              <Clock size={10} /> {formatMs(actual.durationMs)}
                            </span>
                          </div>
                        )}
                      </div>
                      {skippedAfterCache && (
                        <div className="flex items-center gap-2 text-xs mt-1">
                          <span className="badge-neutral">
                            Skipped (Cache Hit)
                          </span>
                        </div>
                      )}
                      <p className="text-xs text-slate-500 mt-0.5">
                        {stage.description}
                      </p>
                      {/* Cache hit/miss badge for cache stage */}
                      {stage.key === "Cache Lookup" && selectedLog && (
                        <div className="mt-1">
                          {selectedLog.cache_hit ? (
                            <span className="badge-success">CACHE HIT</span>
                          ) : (
                            <span className="badge-neutral">CACHE MISS</span>
                          )}
                        </div>
                      )}
                      {/* Status badge for response stage */}
                      {stage.key === "Response" && selectedLog?.status_code && (
                        <div className="mt-1">
                          <span
                            className={classNames(
                              "badge",
                              `badge-${statusCodeBadge(selectedLog.status_code)}`,
                            )}
                          >
                            {selectedLog.status_code}{" "}
                            {selectedLog.status_code >= 200 &&
                            selectedLog.status_code < 300
                              ? "OK"
                              : ""}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Connector arrow at the end */}
              <div className="text-center pt-2">
                {selectedLog ? (
                  <div className="inline-flex items-center gap-2 text-xs text-slate-500">
                    <span>Request ID</span>
                    <code className="font-mono text-slate-400">
                      {selectedLog.request_id}
                    </code>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    Select a request to see the pipeline animation
                  </p>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
