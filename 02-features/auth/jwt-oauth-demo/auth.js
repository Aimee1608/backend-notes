'use strict';

// JWT 核心工具。这里复刻了 OAuth 2.0 的 token 模型(RFC 6749):
// 一个短命的 access token,每次请求都带着;外加一个更长命的 refresh token,
// 只用来换取新的 access token。

const jwt = require('jsonwebtoken');

// 真实服务里这些应来自密钥管理服务 / 环境变量,绝不硬编码。
const ACCESS_SECRET = process.env.ACCESS_SECRET || 'dev-access-secret-change-me';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'dev-refresh-secret-change-me';

// access token 故意设得短命:万一泄露,被滥用的窗口也很小。
// 客户端会用 refresh token 悄悄换一个新的。
const ACCESS_TTL = '15m';
// refresh token 活得久,但很少用到(只在 /refresh 时)。
const REFRESH_TTL = '7d';

function signAccessToken(payload) {
  // payload 携带身份(sub)和授权信息(scope)。
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_TTL });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_TTL });
}

function verifyAccessToken(token) {
  // 过期或被篡改时会抛错;调用方据此返回 401。
  return jwt.verify(token, ACCESS_SECRET);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET);
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  ACCESS_TTL,
  REFRESH_TTL,
};
