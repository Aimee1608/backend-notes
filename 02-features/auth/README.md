# JWT、OAuth、Token 刷新 —— 一个全栈工程师的鉴权入门笔记

> 平时写前端 / 全栈,服务端鉴权我一直是"会用但说不清"。这篇是我把它从头啃明白的笔记,基于公开标准(OAuth 2.0 / RFC 6749、JWT / RFC 7519),配一个能跑的最小 demo。如果你也被 JWT、OAuth、token 刷新绕晕过,希望它对你有用。

## 1. 从几个疑问开始

你有没有想过:
- 为什么有些系统**登录一次,之后很久都不用再登录**?
- 为什么**服务和服务之间互相调用**,也要带一串 token?
- 这串 token 到底是什么、凭什么能证明"我是我"、又凭什么不会被人伪造?

这篇就从最基础的概念,把这几个问题一路讲清楚。(不熟的名词,文末有「名词解释」可随时查。)

## 2. 先分清:认证 vs 授权

两个总被搞混的词,先掰开:
- **认证 (Authentication)**:你是谁? —— 证明身份(登录)
- **授权 (Authorization)**:你能干什么? —— 有没有权限访问某个资源

> 一句话:先"认证"确认你是你,再"授权"决定你能碰哪些东西。

### Session 还是 Token(JWT)?

实现登录态,有两条主流思路:

| | Session-Cookie | Token (JWT) |
|---|---|---|
| 状态存哪 | 服务端存 session,客户端只存 sessionId | 服务端不存,token 自己带信息 |
| 水平扩展 | 多台机器要共享 session(如 Redis) | 无状态,天然好扩展 |
| 跨域 / 多端 | Cookie 跨域麻烦 | 带 header 即可,App / 小程序友好 |
| 注销 | 删 session 即时失效 | 签发后难即时失效(要额外机制) |

**怎么选?**
- 传统单体网站、服务端渲染、需要即时注销 → **Session** 更简单可靠。
- 多端(App / 小程序)、跨域、微服务、要无状态扩展 → **JWT** 更合适。
- 常见折中(也是下面 demo 的做法):**JWT 做 access token + 服务端存一份 refresh token 白名单**,兼顾"无状态"和"可撤销"。

## 3. OAuth 2.0:两种最常见的拿 token 方式

OAuth 2.0(RFC 6749)是业界标准。最常用的两种 grant:

**① 用户授权 —— Authorization Code**
用户在授权页点"同意",应用拿到授权码,再换成 token。
典型场景:**"用 GitHub / 微信账号登录某网站"**。

**② 服务间调用 —— Client Credentials**
没有用户参与,一个服务用自己的 `client_id + client_secret` 换 token,去调它有权限的接口。
典型场景:**后端服务之间互调**。(这俩凭证怎么来、怎么验,见第 5 节。)

**JWT 在这里是什么角色?**
JWT(RFC 7519)是 token 的一种**自包含**格式:本身就带着身份(`sub`)和权限(`scope`),外加签名防篡改。服务端不用查库,**验签 + 读 claims** 就知道"你是谁、能干啥"。

> 简单记:OAuth 解决"怎么安全地把 token 发给你",JWT 解决"这个 token 长什么样、怎么自证"。

## 4. JWT 凭什么不会被伪造?

这是 JWT 最关键、却最容易被略过的一点。既然 claims 是**明文**、谁都能解码看到——那攻击者把自己的 `scope` 改成 `admin`,不就越权了?

答案藏在 JWT 的**第三段:签名 (Signature)**。一个 JWT 长这样,三段用 `.` 隔开:

```
header . payload . signature
eyJ...  .  eyJ...  .  KkvtzZ...
```
- **header**:用了什么签名算法(如 HS256)
- **payload**:就是 claims(明文)
- **signature**:用**密钥**对前两段算出来的一段签名

**验证真伪的过程(验签):**
1. 服务端收到 token,取出 header + payload。
2. 用自己掌握的**密钥**,对 `header.payload` **重新算一遍签名**。
3. 把算出来的签名,和 token 自带的第三段**比对**。
4. **一致** → token 是真的、没被改过;**不一致** → 被伪造 / 篡改,拒绝(返回 401)。

**为什么伪造不了?**
攻击者能看、甚至能改 payload(比如把 scope 改成 admin),但他**没有密钥,算不出对应的合法签名**。服务端用真密钥一验,对不上,当场识破。

> 记住这句:**JWT 的安全不靠"藏住内容"(内容是明文的),而靠"签名"——没有密钥,就伪造不出能通过验证的 token。**

**两种签名方式(知道即可):**
- **HS256(对称)**:一个 `secret`,签发和验证用**同一把钥匙**。适合自己签、自己验(单体应用)。下面的 demo 就是这种。
- **RS256(非对称)**:**私钥签名、公钥验证**。适合"签发方和验证方不是同一个"的场景(第三方登录、多服务、SSO)——验证方只要公钥,不用碰私钥。

**那公钥从哪来?—— JWKS + 公钥轮换**
用 RS256 时,签发方把公钥挂在一个标准端点(**JWKS**,常见 `/.well-known/jwks.json`):里面是一组公钥,每个带一个 `kid`(key id);JWT 的 header 也带 `kid`,验证方按它取对应公钥来验签。验证方会**缓存**公钥;而签发方会定期**轮换密钥**,所以缓存有过期时间——**一旦过期、或遇到没见过的 `kid`,就重新拉一次 JWKS 再验**。妙在:公钥能公开分发,验证方不用预存任何密钥、签发方能独立换钥,这也是它撑得起 SSO / 多服务的原因。(更深入留给 SSO 那篇。)

## 5. 服务怎么证明自己?—— client_id / client_secret

第 3 节的 Client Credentials(服务间调用)里,服务靠 `client_id + client_secret` 换 token。这俩哪来的、怎么验、怎么管,是真实工程里绕不开的一环。

### 本质:服务的"账号密码"
- `client_id` ≈ **用户名**:公开,标识"你是哪个服务"。
- `client_secret` ≈ **密码**:机密,证明"你真的是这个服务"。

区别只是:它给**机器 / 服务**用,不是给人用。

### 怎么来的?
在授权服务器 / 平台**「注册应用」时分配**的:
- 接第三方(GitHub OAuth App、微信开放平台)、用云服务(阿里云 AccessKey)、或公司自建授权服务器 —— 都是注册后平台**发给你一对**。
- `client_id` 通常是个唯一串(如 UUID);`client_secret` 是一段**高熵随机串**,**常只在创建时显示一次**,平台自己存的是它的 **hash**(和用户密码一个道理)。

### 怎么验证?
服务带着 id + secret 来换 token,授权服务器:
1. 收到凭证(标准走 HTTP Basic 头 `Authorization: Basic base64(id:secret)`)。
2. 按 `client_id` 查出记录。
3. **hash 比对** secret(不是明文相等)。
4. 通过 → 签发限定 scope 的 token;否则 `401 invalid_client`。

> 看出来了吗:**和用户登录是同一套** —— 查身份、比对凭证 hash、发 token。

### 怎么管?(这几条最容易在生产里踩雷)
- secret 只放**服务端**,从**环境变量 / 密钥管理(KMS、Vault)**读 —— 绝不硬编码、绝不进 git(demo 里硬编码 `secret-abc` 是反面教材)。
- 传输必须 **HTTPS**,否则 secret 被抓包就废了。
- 支持**轮换 (rotate)**:泄露了能重新生成、旧的作废。
- ⚠️ **纯前端(SPA / App)藏不住 secret** → 这类 "public client" 不能用 client_secret,要改用 **PKCE**(Authorization Code 的增强,不需要 secret)。这是高频坑:很多人把 secret 打包进前端,等于裸奔。

## 6. 动手:一个最小鉴权 demo

光看概念容易飘,我写了个最小可跑的服务(完整代码 👉 [`./jwt-oauth-demo`](./jwt-oauth-demo)),五个接口刚好覆盖上面所有概念:

| 接口 | 作用 |
|---|---|
| `POST /login` | 账号密码换 **access token + refresh token** |
| `GET /profile` | 受保护接口,要验 access token |
| `GET /admin` | 受保护 **且** 要 `admin` scope(演示授权 ≠ 认证) |
| `POST /refresh` | 用 refresh token 换新的 access token(无感续期 + 轮转) |
| `POST /token` | 服务间 `client_credentials` 换 token(凭证怎么来 → 见第 5 节) |

跑起来后,有几个现象值得亲自验证(把 `auth.js` 里 `ACCESS_TTL` 改成 `'30s'` 更明显):
- 带着有效 access token 访问 `/profile` → 正常返回;**不带 token → 401**。
- access token **过期后** `/profile` 报 401 → 调 `/refresh` 拿到新 token → 又能访问了(这就是"登录一次后长期不用重登"的原理)。
- 用 **alice** 能进 `/admin`(她有 `admin` scope),换 **bob** 就 **403**(他没有)—— 这就是"认证通过 ≠ 有权限"。
- **把 access token 最后几个字符改掉**(破坏签名)再访问 `/profile` → **401**,亲眼看到第 4 节说的"篡改后验签失败"。

> 想看 claims 长啥样:把 `/login` 拿到的 token 第二段解码即可——`node -e "console.log(JSON.parse(Buffer.from(process.argv[1].split('.')[1],'base64url')))" "你的token"`。你会看到 `sub`、`scope`、`exp` 明明白白(也就亲眼验证了"JWT 是明文")。

## 7. 几个关键点(也是容易踩的坑)

把 demo 跑通后,这几点是真正要记住的:

- **access token 要短命**:万一泄露,被滥用的窗口也小;靠 refresh token 在后台悄悄续。
- **refresh token 要能撤销**:所以服务端存一份白名单(demo 用内存 Set,生产用 Redis),登出 / 轮转时删掉。
- **token 轮转 (rotation)**:每次刷新都换一对新的、旧的作废,降低泄露风险;这也是"**长时间不操作才要求重新登录**"(滑动过期)的实现基础。
- **JWT 不是加密,只是编码**:它就是 base64,**谁都能解开看里面的内容** —— 签名只保证"没被篡改",不保证"保密",所以绝不能往 JWT 里塞密码、隐私这类敏感信息。
- **凭证别硬编码**:无论用户密码还是 client_secret,都要 hash 存储、从密钥管理读取——别像 demo 那样写死在代码里。
- **注销是个难题**:无状态 JWT 一旦签发,过期前很难即时失效 —— 实务里靠"短 TTL + 黑名单 / 白名单"兜底。

## 8. 小结 & 速查

鉴权这套东西,拆开看其实就几层:**认证**(你是谁)→ **授权**(你能干啥)→ **会话维持**(用 access / refresh token 让你不用反复登录);而**签名**保证这张牌不会被伪造,**密钥管理**保证发牌的"母钥匙"不泄露。OAuth 负责安全发牌,JWT 负责让牌自证。

一张速查表收尾:

| 场景 / 问题 | 推荐做法 |
|---|---|
| 传统单体网站、要即时注销 | Session-Cookie |
| 多端 / App / 小程序、跨域 | JWT(access) + 服务端 refresh 白名单 |
| 让用户用第三方账号登录 | OAuth2 Authorization Code |
| 后端服务之间互调 | OAuth2 Client Credentials |
| access token 有效期 | 短(如 15 分钟) |
| refresh token | 长(如 7 天)+ 存白名单可撤销 + 轮转 |
| 防伪造 | 靠签名验证;跨方验证用 RS256(公钥验) |
| client_secret / 密码 | 注册分配、**hash 存**、密钥管理读、HTTPS 传、可轮换 |
| 前端(SPA/App)拿 token | 用 **PKCE**,**不要**放 client_secret |
| 敏感信息 | **绝不**放进 JWT(能被直接解码) |

## 附:名词解释

刚接触鉴权,这些词容易卡,放这儿随时查:

- **认证 (Authentication)**:证明"你是谁"(登录)。
- **授权 (Authorization)**:决定"你能干什么"(权限)。
- **Token**:登录后服务端发给你的一张"凭证",之后每次请求带着它证明身份。
- **JWT (JSON Web Token)**:一种自包含的 token 格式,由 `header.payload.signature` 三段组成。
- **Header / Payload / Signature**:JWT 的三段 —— 头部(用什么算法)/ 载荷(claims)/ 签名(防伪造)。
- **Claims(声明)**:JWT payload 里的字段,每条是一个"声明",如 `sub`、`scope`、`exp`。
- **sub / iat / exp**:常见的标准 claim —— 主体(用户 id)/ 签发时间 / 过期时间。
- **Scope(权限范围)**:这个 token 被允许做哪些事,如 `profile`、`admin`。
- **Access Token**:短命的访问凭证,每次请求都带。
- **Refresh Token**:长命的"续命"凭证,只用来换新的 access token。
- **Grant(授权方式)**:OAuth 里"怎么拿到 token"的几种标准流程,如 Authorization Code、Client Credentials。
- **client_id / client_secret**:服务的"用户名 / 密码",注册应用时由平台分配;secret 机密,只放服务端。
- **验签(签名验证)**:用密钥重算签名并比对,确认 token 真实、没被篡改。
- **HS256 / RS256**:两种签名算法 —— 对称(一个 secret,签验同一把钥匙)/ 非对称(私钥签、公钥验)。
- **JWKS**:签发方发布公钥的标准端点(一组公钥);RS256 的验证方从这里拉公钥,配合 `kid` 选对 key,并随密钥轮换更新。
- **kid (key id)**:公钥的编号;JWT header 用它指明"该用哪把公钥来验"。
- **PKCE**:Authorization Code 的安全增强,让藏不住 secret 的前端 / App 也能安全拿 token,无需 client_secret。
- **密钥管理 (KMS / Vault)**:专门安全存取密钥 / secret 的服务,避免把机密硬编码进代码。
- **Token 轮转 (Rotation)**:每次刷新都换一对新 token、旧的作废,降低泄露风险。

---

> 这是我"补服务端短板"系列的第一篇。鉴权远不止于此 —— 后面会接着写**接 SSO 单点登录 + 权限划分**、**扫码 / 手机号 / 邮箱登录怎么设计**、以及**小公司到底该自建还是用第三方身份服务**。感兴趣可以蹲一下。
