// Run: `node demo.js`
// 模拟一个"服务"处理一批请求,内置可观测性三件套,跑完打印三部分后退出:
//   ① Metrics    —— 每个接口的 RED(请求量/错误率/耗时),并导出 Prometheus 文本格式
//   ② Logging    —— 处理过程中的结构化日志(JSON 行,带 traceId / level)
//   ③ Tracing    —— 一条慢请求的 span 树 + 总耗时,直观看出慢在哪一环
const { Metrics, Logger, Tracer, sleep } = require('./lib');

function title(t) { console.log(`\n=== ${t} ===`); }
function bar(ms, scale = 4) { return '█'.repeat(Math.max(1, Math.round(ms / scale))); }

// ---- 被监控的"服务":处理一个请求,内部跨 3 个 span(handler → db → cache)----
// 每个接口给不同的耗时/错误特征,好让指标和链路看出差异。
const PROFILES = {
  '/order':  { dbMs: 35, cacheMs: 5,  errorRate: 0.15 }, // 慢且偶发出错(本 demo 的"问题接口")
  '/user':   { dbMs: 8,  cacheMs: 4,  errorRate: 0.0 },
  '/health': { dbMs: 1,  cacheMs: 1,  errorRate: 0.0 },
};

// 处理单个请求:开一条 trace,记录三件套。
async function handleRequest(path, { metrics, logger, tracer }) {
  const profile = PROFILES[path];
  const root = tracer.startTrace(`HTTP ${path}`); // 根 span = 整个请求
  const traceId = root.traceId;
  const startedAt = Date.now();

  logger.info(traceId, 'request received', { path });

  // span 1:cache —— 先查缓存(这里简单模拟未命中)
  const cacheSpan = root.child('cache.get');
  await sleep(profile.cacheMs);
  logger.debug(traceId, 'cache miss', { path }); // debug 默认被过滤,体现"级别"
  cacheSpan.end();

  // span 2:db —— 回源查数据库(通常是最慢的一环)
  const dbSpan = root.child('db.query');
  await sleep(profile.dbMs);
  dbSpan.end();

  // 按概率模拟一次失败
  const failed = Math.random() < profile.errorRate;
  if (failed) {
    logger.error(traceId, 'request failed', { path, code: 500, reason: 'db timeout' });
  }

  root.end();
  const durationMs = Date.now() - startedAt;
  metrics.observe(path, { error: failed, durationMs }); // 落一笔指标(RED)
  return { traceId, durationMs, failed };
}

async function main() {
  const metrics = new Metrics();
  const tracer = new Tracer();

  // ② 先单独演示 Logging:用一个会"打印"的 logger 跑几条请求,看结构化日志长什么样。
  title('② Logging · 结构化日志(JSON 行,debug 默认被级别过滤)');
  const loudLogger = new Logger({ minLevel: 'info' }); // info 及以上才输出
  for (const path of ['/user', '/order', '/order']) {
    await handleRequest(path, { metrics, logger: loudLogger, tracer });
  }
  console.log('  ↑ 每行一条 JSON,靠 traceId 能把同一个请求的日志串起来;');
  console.log('    debug 级("cache miss")没出现 —— 被 minLevel=info 过滤掉了。');

  // 跑一批"流量",喂给指标(这部分日志静音,免得刷屏)。
  const silentLogger = new Logger({ minLevel: 'error', sink: () => {} });
  const paths = ['/order', '/user', '/health'];
  for (let i = 0; i < 200; i++) {
    const path = paths[Math.floor(Math.random() * paths.length)];
    await handleRequest(path, { metrics, logger: silentLogger, tracer });
  }

  // ① Metrics:RED 汇总表 + Prometheus 文本格式
  title('① Metrics · 每个接口的 RED(Rate / Errors / Duration)');
  console.log('  ' + ['接口'.padEnd(10), 'Rate', 'Errors', 'ErrRate', 'avg', 'p95'].join('  '));
  for (const r of metrics.summary().sort((a, b) => b.p95Ms - a.p95Ms)) {
    console.log('  ' + [
      r.path.padEnd(10),
      String(r.requests).padStart(4),
      String(r.errors).padStart(6),
      (r.errorRate * 100).toFixed(1).padStart(6) + '%',
      (r.avgMs + 'ms').padStart(6),
      (r.p95Ms + 'ms').padStart(6),
    ].join('  '));
  }
  console.log('  ← 一眼看出:/order 的 p95 最高、还有错误率 —— 它是"嫌疑接口"。');

  title('① Metrics · 导出为 Prometheus 文本格式(Prometheus 来拉的就是这个)');
  console.log(metrics.toPrometheus().split('\n').map((l) => '  ' + l).join('\n'));

  // ③ Tracing:专门为"接口变慢"的排查,抓一条 /order 的慢请求,画出 span 树。
  title('③ Tracing · 一条 /order 请求的 span 树(看慢在哪一环)');
  const traceLogger = new Logger({ minLevel: 'error', sink: () => {} });
  const { traceId } = await handleRequest('/order', { metrics, logger: traceLogger, tracer });
  const tree = tracer.treeOf(traceId);

  const printNode = (node, depth = 0) => {
    const indent = '  ' + '  '.repeat(depth);
    const label = (depth === 0 ? '' : '└─ ') + node.name;
    console.log(`${indent}${label.padEnd(22 - depth * 2)} ${String(node.durationMs).padStart(3)}ms  ${bar(node.durationMs)}`);
    node.children.forEach((c) => printNode(c, depth + 1));
  };
  printNode(tree);
  console.log(`\n  traceId=${traceId}  总耗时 ${tree.durationMs}ms`);
  console.log('  ← 条形最长的 db.query 就是瓶颈;接着就该去翻这条 traceId 的日志看 db 那一环发生了什么。');

  console.log('\n排查心法:指标定位"哪个接口慢" → 链路定位"慢在哪一段" → 日志定位"那一段到底报了什么"。\n');
}

main();
