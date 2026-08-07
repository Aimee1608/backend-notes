# AI 大模型系列 · 选题规划

系列定位：面向有后端基础的研发，把 LLM 应用开发里绕不开的概念和工程问题，一个个讲清楚。不堆论文术语，聚焦"搞懂能用"。
发布合集：研发都要懂的事
发布节奏：每天 1-2 篇
文章风格（交叉使用）：
- 「这个概念你真的懂吗」
- 「接到这个需求你先别急」
- 「踩坑记录」
- 「选型对比」

---

## 一、LLM 基础认知（先搞懂它是什么）

| # | 文件 | 标题核心 | 关键知识点 | 风格 |
|---|------|---------|-----------|------|
| 01 | 01-token.md | Token 是什么，为什么不按字数收费 | Tokenizer、中英文 token 差异、计费逻辑 | 这个概念你真的懂吗 |
| 02 | 02-context-window.md | Context Window 超出了会怎样 | 上下文长度限制、超出后的截断策略、长文档处理 | 踩坑记录 |
| 03 | 03-temperature.md | Temperature 和 Top-p 调哪个，有什么区别 | 采样参数对输出的影响、什么场景调什么 | 选型对比 |
| 04 | 04-hallucination.md | LLM 为什么会"一本正经地胡说"，能根治吗 | 幻觉的来源、缓解手段（RAG/引用/校验）、不能根治的原因 | 这个概念你真的懂吗 |
| 05 | 05-embedding.md | Embedding 向量是什么，怎么表示语义 | 向量化原理、余弦相似度、为什么能做语义搜索 | 这个概念你真的懂吗 |

---

## 二、Prompt Engineering（写提示词是门技术活）

| # | 文件 | 标题核心 | 关键知识点 | 风格 |
|---|------|---------|-----------|------|
| 06 | 06-prompt-basics.md | 同样的问题，不同 Prompt 效果差在哪 | 描述清晰、角色设定、约束条件、输出格式 | 踩坑记录 |
| 07 | 07-system-prompt.md | System Prompt 和 User Prompt 的区别与边界 | 角色设定、权重差异、被用户覆盖的风险 | 这个概念你真的懂吗 |
| 08 | 08-few-shot.md | Few-shot 示例放几个最好，放多了有什么副作用 | 零样本/少样本/多样本对比、示例质量 > 数量 | 选型对比 |
| 09 | 09-chain-of-thought.md | 让模型"先想再答"为什么更准——Chain-of-Thought | CoT 原理、"Let's think step by step"为什么有效 | 这个概念你真的懂吗 |
| 10 | 10-structured-output.md | 让 LLM 老实返回 JSON，怎么做才靠谱 | JSON mode、输出格式约束、解析失败重试 | 踩坑记录 |
| 11 | 11-prompt-injection.md | 用户输入破坏了你的 System Prompt——Prompt 注入 | 注入攻击模式、防御手段、越狱原理 | 踩坑记录 |

---

## 三、RAG 系统（给模型接上你的知识库）

| # | 文件 | 标题核心 | 关键知识点 | 风格 |
|---|------|---------|-----------|------|
| 12 | 12-rag-why.md | 为什么不直接把文档塞进 Context，非要用 RAG | Context 长度限制、成本、检索精度 vs 全量塞入 | 这个概念你真的懂吗 |
| 13 | 13-chunk-strategy.md | 文档切片切多大，这个参数比你想的重要 | Chunk size 过大 / 过小的问题、重叠策略、按语义切 | 踩坑记录 |
| 14 | 14-vector-db.md | 向量数据库怎么选——Milvus / Weaviate / pgvector 对比 | 选型维度：规模、延迟、托管 vs 自建、与现有栈集成 | 选型对比 |
| 15 | 15-retrieval-problem.md | 检索出来了但答案还是不对，召回率和精确率怎么平衡 | 相似度阈值、Top-K 调参、检索评估指标 | 踩坑记录 |
| 16 | 16-hybrid-search.md | 向量搜索 + 关键词搜索混着用，效果比单一好 | BM25 + 向量混合检索、RRF 重排、什么场景选哪种 | 选型对比 |
| 17 | 17-rerank.md | 检索完了再过一遍 Rerank，为什么值得 | Reranker 的作用、Cross-encoder vs Bi-encoder | 这个概念你真的懂吗 |
| 18 | 18-rag-eval.md | RAG 系统怎么评估，没有标准答案怎么办 | RAGAS 框架、忠实度 / 相关性 / 召回率评估 | 接到这个需求你先别急 |

---

## 四、Agent 与工具调用（让模型能做事）

| # | 文件 | 标题核心 | 关键知识点 | 风格 |
|---|------|---------|-----------|------|
| 19 | 19-function-calling.md | Function Calling 是什么，模型怎么"调接口" | Tool schema、参数提取、结果回传流程 | 这个概念你真的懂吗 |
| 20 | 20-react-agent.md | Agent 为什么会死循环，ReAct 框架怎么设计 | Reason + Act 循环、最大步数限制、错误恢复 | 踩坑记录 |
| 21 | 21-agent-memory.md | Agent 怎么"记住"之前的对话——Memory 设计 | 短期/长期 Memory、对话摘要压缩、向量记忆 | 这个概念你真的懂吗 |
| 22 | 22-multi-agent.md | 什么时候需要多个 Agent 协作，怎么拆 | 单 Agent 的边界、Orchestrator + Subagent 模式 | 接到这个需求你先别急 |
| 23 | 23-mcp.md | MCP 是什么，为什么最近这么火 | Model Context Protocol 原理、工具生态、和 Function Calling 的区别 | 这个概念你真的懂吗 |
| 24 | 24-tool-reliability.md | 工具调用失败了，Agent 怎么恢复 | 重试策略、工具调用幂等、降级兜底 | 踩坑记录 |

---

## 五、工程化与生产（真正上线要想的事）

| # | 文件 | 标题核心 | 关键知识点 | 风格 |
|---|------|---------|-----------|------|
| 25 | 25-streaming.md | LLM 接口等 5 秒才出结果，用 Streaming 怎么做 | SSE / WebSocket、流式输出原理、前后端实现 | 踩坑记录 |
| 26 | 26-cost-control.md | Token 成本失控，几个压缩 Prompt 的实用技巧 | Prompt 瘦身、缓存复用、模型分级路由 | 接到这个需求你先别急 |
| 27 | 27-latency-optimize.md | 首 Token 延迟怎么优化，KV Cache 是什么 | TTFT vs TPOT、KV Cache 命中率、请求调度 | 这个概念你真的懂吗 |
| 28 | 28-retry-fallback.md | LLM 输出不稳定，怎么做重试和降级 | 输出格式校验、重试次数上限、降级到简单模型 | 踩坑记录 |
| 29 | 29-prompt-cache.md | Prompt Cache 能省多少钱，怎么命中 | 前缀缓存原理、结构化 System Prompt、命中率优化 | 选型对比 |
| 30 | 30-llm-gateway.md | 多个模型统一接入，LLM Gateway 怎么设计 | 统一 API 层、模型路由、Key 管理、限流计费 | 接到这个需求你先别急 |
| 31 | 31-observability.md | LLM 应用上了线，怎么看它在干什么 | Trace 链路、Token 用量监控、响应质量告警 | 接到这个需求你先别急 |

---

## 六、模型选型与微调（用哪个、怎么改）

| # | 文件 | 标题核心 | 关键知识点 | 风格 |
|---|------|---------|-----------|------|
| 32 | 32-model-selection.md | GPT-4o / Claude / Gemini / 开源模型，怎么选 | 能力对比、价格、延迟、合规隐私、选型决策树 | 选型对比 |
| 33 | 33-local-vs-api.md | 本地部署 vs 调 API，什么场景选哪个 | 成本临界点、数据隐私、延迟要求、运维代价 | 选型对比 |
| 34 | 34-when-to-finetune.md | 什么情况下需要微调，Prompt 搞不定了再说 | 微调的适用场景、成本、数据量要求、先跑 RAG 再考虑微调 | 接到这个需求你先别急 |
| 35 | 35-lora.md | LoRA 是什么，为什么比全量微调便宜这么多 | 低秩分解原理、可训练参数量对比、QLoRA | 这个概念你真的懂吗 |
| 36 | 36-finetune-data.md | 微调数据怎么准备，质量比数量重要在哪 | 数据清洗、格式规范、数据量经验值、合成数据 | 踩坑记录 |

---

## 七、前沿方向（了解趋势、不被带跑）

| # | 文件 | 标题核心 | 关键知识点 | 风格 |
|---|------|---------|-----------|------|
| 37 | 37-long-context.md | Context Window 越来越长，RAG 还有必要吗 | 长上下文的成本/精度问题、RAG 的不可替代场景 | 这个概念你真的懂吗 |
| 38 | 38-reasoning-model.md | o1/o3 这类推理模型，和普通 LLM 有什么本质区别 | 慢思考 vs 快思考、Chain-of-Thought 内化、适用场景 | 这个概念你真的懂吗 |
| 39 | 39-multimodal.md | 多模态模型能做什么，Vision 和 OCR 不是一回事 | 图像理解 vs OCR vs 图表分析、接入流程 | 这个概念你真的懂吗 |
| 40 | 40-vibe-coding.md | Vibe Coding 是什么，AI 写代码到底能用到什么程度 | AI 辅助编程的边界、什么代码能让 AI 写、什么不能 | 这个概念你真的懂吗 |
