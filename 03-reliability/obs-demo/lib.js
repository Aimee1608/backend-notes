// A zero-dependency in-memory demo of the three pillars of observability.
// 用内存模拟一个"服务",内置可观测性三件套:Metrics / Logging / Tracing。
// 不依赖 Prometheus / Grafana / OpenTelemetry,直接 `node demo.js` 即可。

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 生成一个短 traceId / spanId(真实世界是 16/32 位十六进制,这里截短便于阅读)。
let _seq = 0;
function genId(prefix) {
  _seq += 1;
  return `${prefix}-${_seq.toString(16).padStart(4, '0')}`;
}

// ============ 支柱一:Metrics(指标)============
// 按 RED 方法收集每个接口的:Rate(请求量)/ Errors(错误数)/ Duration(耗时)。
// 这些都是"按时间累加的数",真实世界存进时序数据库,被 Prometheus 拉取(pull)。
class Metrics {
  constructor() {
    // path -> { requests, errors, durations[] }
    this.byPath = new Map();
  }

  _bucket(path) {
    if (!this.byPath.has(path)) {
      this.byPath.set(path, { requests: 0, errors: 0, durations: [] });
    }
    return this.byPath.get(path);
  }

  // 每处理完一个请求记一笔:是否出错、耗时多少。
  observe(path, { error, durationMs }) {
    const b = this._bucket(path);
    b.requests += 1;
    if (error) b.errors += 1;
    b.durations.push(durationMs);
  }

  // 简单求分位数(p50/p95):真实世界用直方图(histogram)近似,这里直接排序取值。
  _percentile(arr, p) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
  }

  // 给人看的汇总:RED 三个数 + p95。
  summary() {
    const rows = [];
    for (const [path, b] of this.byPath) {
      const avg = b.durations.reduce((s, d) => s + d, 0) / (b.durations.length || 1);
      rows.push({
        path,
        requests: b.requests,
        errors: b.errors,
        errorRate: b.requests ? (b.errors / b.requests) : 0,
        avgMs: Math.round(avg),
        p95Ms: this._percentile(b.durations, 95),
      });
    }
    return rows;
  }

  // 导出成 Prometheus 文本格式(exposition format)。
  // 真实世界 Prometheus 来 /metrics 拉的就是这种纯文本,每行一个带标签的样本。
  toPrometheus() {
    const lines = [];
    lines.push('# HELP http_requests_total Total number of HTTP requests.');
    lines.push('# TYPE http_requests_total counter');
    for (const [path, b] of this.byPath) {
      lines.push(`http_requests_total{path="${path}"} ${b.requests}`);
    }
    lines.push('# HELP http_request_errors_total Total number of failed HTTP requests.');
    lines.push('# TYPE http_request_errors_total counter');
    for (const [path, b] of this.byPath) {
      lines.push(`http_request_errors_total{path="${path}"} ${b.errors}`);
    }
    lines.push('# HELP http_request_duration_ms_p95 95th percentile request duration in ms.');
    lines.push('# TYPE http_request_duration_ms_p95 gauge');
    for (const [path, b] of this.byPath) {
      lines.push(`http_request_duration_ms_p95{path="${path}"} ${this._percentile(b.durations, 95)}`);
    }
    return lines.join('\n');
  }
}

// ============ 支柱二:Logging(结构化日志)============
// 输出 JSON 行(一行一条),带固定字段:ts / level / traceId / msg / ...
// 结构化的好处:机器可检索 —— 真实世界由 ELK / Loki 集中收集后按字段过滤。
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

class Logger {
  // minLevel 以下的日志直接丢弃 —— 别让 debug 噪音淹没线上。
  constructor(opts = {}) {
    this.minLevel = LEVELS[opts.minLevel || 'info'];
    this.sink = opts.sink || ((line) => console.log(line)); // 默认打到 stdout
  }

  _log(level, traceId, msg, fields = {}) {
    if (LEVELS[level] < this.minLevel) return;
    const entry = {
      ts: new Date().toISOString(),
      level,
      traceId,
      msg,
      ...fields,
    };
    this.sink(JSON.stringify(entry)); // 一条日志 = 一行 JSON
  }

  debug(traceId, msg, fields) { this._log('debug', traceId, msg, fields); }
  info(traceId, msg, fields) { this._log('info', traceId, msg, fields); }
  warn(traceId, msg, fields) { this._log('warn', traceId, msg, fields); }
  error(traceId, msg, fields) { this._log('error', traceId, msg, fields); }
}

// ============ 支柱三:Tracing(链路追踪)============
// 一个请求 = 一条 trace,贯穿它的全部步骤;每一步(handler / db / cache)是一个 span。
// 同一条 trace 的所有 span 共享一个 traceId;span 之间用 parent 串成一棵树。
// 真实世界由 OpenTelemetry 采集、Jaeger 之类展示,核心数据结构就是下面这个。
class Tracer {
  constructor() {
    this.spans = []; // 收集所有已结束的 span(扁平存,靠 parentId 还原成树)
  }

  // 开一条新 trace(根 span):返回一个带 traceId 的 span 句柄。
  startTrace(name) {
    return this._startSpan(genId('trace'), null, name);
  }

  _startSpan(traceId, parentId, name) {
    const span = {
      traceId,
      spanId: genId('span'),
      parentId,
      name,
      startAt: Date.now(),
      endAt: null,
    };
    const self = this;
    return {
      span,
      // 在当前 span 下开一个子 span(比如 handler 里调 db)。
      child(childName) { return self._startSpan(traceId, span.spanId, childName); },
      // 结束这个 span,落进收集器。
      end() {
        span.endAt = Date.now();
        self.spans.push(span);
        return span;
      },
      get traceId() { return traceId; },
    };
  }

  // 把某条 trace 的扁平 span 列表还原成树,并标出每段耗时(用于打印 span 树)。
  treeOf(traceId) {
    const list = this.spans.filter((s) => s.traceId === traceId);
    const byParent = new Map();
    for (const s of list) {
      const arr = byParent.get(s.parentId) || [];
      arr.push(s);
      byParent.set(s.parentId, arr);
    }
    const build = (parentId) =>
      (byParent.get(parentId) || [])
        .sort((a, b) => a.startAt - b.startAt)
        .map((s) => ({
          name: s.name,
          durationMs: (s.endAt ?? s.startAt) - s.startAt,
          children: build(s.spanId),
        }));
    const roots = build(null);
    return roots[0] || null; // 一条 trace 只有一个根 span
  }
}

module.exports = { Metrics, Logger, Tracer, sleep, genId };
