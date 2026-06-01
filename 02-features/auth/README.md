# 鉴权 (Authentication & Authorization)

> 一个全栈工程师补服务端的**鉴权专题**:从机制到落地选型,每篇配可运行 demo 或决策表。全部基于公开标准,持续更新。

## 本专题文章

1. [**JWT、OAuth、Token 刷新 —— 鉴权入门**](./01-jwt-oauth-basics.md)
   讲 **token 怎么工作**:认证 vs 授权、Session vs JWT、OAuth 两种 grant、签名验签、JWKS、client 凭证、refresh 轮转。配一个可运行的最小 demo。

2. [**鉴权怎么落地?—— 场景选型与避坑**](./02-scenarios-and-selection.md)
   讲 **真要做时怎么选**:第三方登录(含微信门槛)、SSO + RBAC、手机 / 邮箱 / 扫码 / Web↔App 协作登录、前端鉴权、微服务;自己搭 vs 用第三方(IDaaS);通用避坑清单。

## 配套 demo

- [`jwt-oauth-demo/`](./jwt-oauth-demo) —— 第一篇的最小鉴权服务(JWT + OAuth2,可跑)。

## 计划中

- 挑一个场景**深入展开**:自建登录体系 / SSO 落地…

---

> 命名约定:本专题(及整个仓库)正文一律 `NN-语义名.md`,`README.md` 只做目录页,demo / 资源放单独文件夹。
