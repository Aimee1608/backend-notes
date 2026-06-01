'use strict';

// 一个最小的鉴权服务,演示"登录一次、之后不用反复登录"背后的几块拼图:
//   POST /login    -> 用账号密码换 access + refresh token
//   GET  /profile  -> 受保护资源,需要有效的 access token
//   GET  /admin    -> 受保护 且 需要 "admin" scope(授权)
//   POST /refresh  -> 用 refresh token 换新的 access token(并轮转)
//   POST /token    -> 服务间鉴权(OAuth2 client_credentials)
//
// 这里全部是公开的 OAuth 2.0 / JWT 标准,无任何专有内容。

const express = require('express');
const {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} = require('./auth');
const { findUser, findUserById, refreshAllowList } = require('./store');

const app = express();
app.use(express.json());

// --- 1. 登录:凭证 -> token ----------------------------------------------
app.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = findUser(username, password);
  if (!user) return res.status(401).json({ error: 'invalid_credentials' });

  // access token 携带身份(sub)和能做什么(scope)。
  const accessToken = signAccessToken({ sub: user.id, scope: user.scopes.join(' ') });
  const refreshToken = signRefreshToken({ sub: user.id });
  refreshAllowList.add(refreshToken);

  res.json({ token_type: 'Bearer', access_token: accessToken, refresh_token: refreshToken });
});

// --- 中间件:要求有效的 access token -------------------------------------
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing_token' });
  try {
    req.user = verifyAccessToken(token); // { sub, scope, iat, exp }
    next();
  } catch (err) {
    // 过期或被篡改 -> 401。客户端应去 /refresh 换新的,再重试。
    return res.status(401).json({ error: 'invalid_token', reason: err.message });
  }
}

// --- 中间件:要求特定 scope(授权,而非认证)-----------------------------
function requireScope(scope) {
  return (req, res, next) => {
    const scopes = (req.user.scope || '').split(' ');
    if (!scopes.includes(scope)) return res.status(403).json({ error: 'insufficient_scope' });
    next();
  };
}

// --- 2. 受保护资源 ------------------------------------------------------
app.get('/profile', requireAuth, (req, res) => {
  const user = findUserById(req.user.sub);
  res.json({ id: user.id, username: user.username, scopes: user.scopes });
});

// --- 3. 受保护 且 需要 scope(认证 vs 授权)-----------------------------
app.get('/admin', requireAuth, requireScope('admin'), (req, res) => {
  res.json({ ok: true, message: 'welcome to the admin area' });
});

// --- 4. 刷新:用 refresh token 换新的 access token -----------------------
app.post('/refresh', (req, res) => {
  const { refresh_token: refreshToken } = req.body || {};
  if (!refreshToken || !refreshAllowList.has(refreshToken)) {
    return res.status(401).json({ error: 'invalid_refresh_token' });
  }
  try {
    const payload = verifyRefreshToken(refreshToken);
    const user = findUserById(payload.sub);
    // 轮转:作废旧的 refresh token,签发新的一对。这样万一 refresh token
    // 泄露,损失也有限;这也是"滑动会话"的基础(活跃就一直在线,
    // 长时间不操作才要求重新登录)。
    refreshAllowList.delete(refreshToken);
    const newAccess = signAccessToken({ sub: user.id, scope: user.scopes.join(' ') });
    const newRefresh = signRefreshToken({ sub: user.id });
    refreshAllowList.add(newRefresh);
    res.json({ token_type: 'Bearer', access_token: newAccess, refresh_token: newRefresh });
  } catch (err) {
    return res.status(401).json({ error: 'invalid_refresh_token', reason: err.message });
  }
});

// --- 5. 服务间 token(OAuth2 client_credentials)------------------------
// 没有用户参与:一个服务用 client_id + client_secret 证明自己身份,
// 拿到一个限定其可调用范围的 token。
//
// ⚠️ 以下是简化演示,真实环境的区别:
//   1) client_id / client_secret 不是硬编码,而是在授权服务器「注册应用」时分配
//      (client_id 公开标识;client_secret 是高熵随机串、机密,通常只显示一次)。
//   2) 服务端存 secret 的 hash(像用户密码),验证时 hash 比对,而非明文相等。
//   3) secret 从环境变量 / 密钥管理(KMS、Vault)读取,绝不硬编码、绝不进 git。
//   4) 标准传法是 HTTP Basic 头 `Authorization: Basic base64(id:secret)`,这里用 body 仅为简化。
const SERVICE_CLIENTS = { 'svc-reporting': 'secret-abc' }; // 仅 demo,真实环境别这样
app.post('/token', (req, res) => {
  const { client_id: clientId, client_secret: clientSecret, grant_type: grantType } = req.body || {};
  if (grantType !== 'client_credentials') return res.status(400).json({ error: 'unsupported_grant_type' });
  // 简化:明文字符串比对;生产应为 hash 比对(如 bcrypt.compare)。
  if (SERVICE_CLIENTS[clientId] !== clientSecret) return res.status(401).json({ error: 'invalid_client' });
  const accessToken = signAccessToken({ sub: clientId, scope: 'service:read' });
  res.json({ token_type: 'Bearer', access_token: accessToken });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`auth demo listening on http://localhost:${PORT}`));

module.exports = app;
