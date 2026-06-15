# 可观测性 demo:三大支柱(零依赖)

配套文章:《可观测性:线上出问题怎么查》

这个 demo **不用装 Prometheus / Grafana / OpenTelemetry** —— 用内存模拟一个"服务"
处理一批请求,把可观测性三件套(Metrics / Logging / Tracing)在终端里直接打印出来,
跑完即退出。

## 怎么跑

```bash
node demo.js
# 或
npm start
```

## 演示了什么

| 支柱 | 回答的问题 | demo 里看什么 |
|---|---|---|
| **Metrics(指标)** | 系统现在健康吗? | 每个接口的 RED(请求量/错误率/耗时 p95)汇总表,并导出 **Prometheus 文本格式** |
| **Logging(日志)** | 具体发生了什么? | **结构化日志**(JSON 行,带 `traceId` / `level`);`debug` 级被 `minLevel` 过滤掉 |
| **Tracing(链路)** | 这个慢请求卡在哪一环? | 一条 `/order` 请求的 **span 树**(handler → cache → db)+ 总耗时,条形最长的就是瓶颈 |

最后还演示了**排查路径**:指标定位"哪个接口慢"(`/order` 的 p95 最高)→ 链路定位
"慢在哪一段"(`db.query` 那段最长)→ 日志定位"那一段到底报了什么"(按 `traceId` 翻日志)。

## 文件

- `lib.js` —— 三件套的最小实现:`Metrics`(RED + Prometheus 导出)、`Logger`(结构化日志 + 级别)、`Tracer`(span 树),带中文注释
- `demo.js` —— 模拟一个服务处理 200 个请求,打印三部分后退出

## 注意

真实项目里:指标由 **Prometheus** 拉取、**Grafana** 画看板,存进**时序数据库**;
日志由 **ELK / Loki** 集中收集;链路由 **OpenTelemetry** 采集、**Jaeger** 之类展示。
这里全部用内存 `Map` / 数组模拟,是为了**零依赖、聚焦数据结构和思路**——
换成真家伙时,概念一一对应:`Metrics.toPrometheus()` → `/metrics` 端点,
`Logger` 的 JSON 行 → 日志采集器,`Tracer` 的 span 树 → OpenTelemetry 的 trace。
