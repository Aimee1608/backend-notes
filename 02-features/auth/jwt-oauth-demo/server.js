'use strict';

// A minimal auth server showing the pieces behind "log in once, then keep
// calling APIs without logging in again":
//   POST /login    -> exchange credentials for access + refresh tokens
//   GET  /profile  -> protected resource, needs a valid access token
//   GET  /admin    -> protected AND needs the "admin" scope (authorization)
//   POST /refresh  -> swap a refresh token for a fresh access token (+ rotation)
//   POST /token    -> service-to-service token (OAuth2 client_credentials)
//
// Everything here is the public OAuth 2.0 / JWT standard. Nothing proprietary.

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

// --- 1. Login: credentials -> tokens -------------------------------------
app.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = findUser(username, password);
  if (!user) return res.status(401).json({ error: 'invalid_credentials' });

  // The access token carries identity (sub) + what they may do (scope).
  const accessToken = signAccessToken({ sub: user.id, scope: user.scopes.join(' ') });
  const refreshToken = signRefreshToken({ sub: user.id });
  refreshAllowList.add(refreshToken);

  res.json({ token_type: 'Bearer', access_token: accessToken, refresh_token: refreshToken });
});

// --- Middleware: require a valid access token ----------------------------
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing_token' });
  try {
    req.user = verifyAccessToken(token); // { sub, scope, iat, exp }
    next();
  } catch (err) {
    // Expired or tampered -> 401. The client should call /refresh, then retry.
    return res.status(401).json({ error: 'invalid_token', reason: err.message });
  }
}

// --- Middleware: require a specific scope (authorization, not authentication)
function requireScope(scope) {
  return (req, res, next) => {
    const scopes = (req.user.scope || '').split(' ');
    if (!scopes.includes(scope)) return res.status(403).json({ error: 'insufficient_scope' });
    next();
  };
}

// --- 2. Protected resource ----------------------------------------------
app.get('/profile', requireAuth, (req, res) => {
  const user = findUserById(req.user.sub);
  res.json({ id: user.id, username: user.username, scopes: user.scopes });
});

// --- 3. Protected AND scope-gated ---------------------------------------
app.get('/admin', requireAuth, requireScope('admin'), (req, res) => {
  res.json({ ok: true, message: 'welcome to the admin area' });
});

// --- 4. Refresh: swap a refresh token for a new access token -------------
app.post('/refresh', (req, res) => {
  const { refresh_token: refreshToken } = req.body || {};
  if (!refreshToken || !refreshAllowList.has(refreshToken)) {
    return res.status(401).json({ error: 'invalid_refresh_token' });
  }
  try {
    const payload = verifyRefreshToken(refreshToken);
    const user = findUserById(payload.sub);
    // Rotation: invalidate the old refresh token and issue a new pair. This
    // limits damage if a refresh token leaks, and underpins "sliding" sessions
    // (stay logged in while active; re-auth only after a long idle period).
    refreshAllowList.delete(refreshToken);
    const newAccess = signAccessToken({ sub: user.id, scope: user.scopes.join(' ') });
    const newRefresh = signRefreshToken({ sub: user.id });
    refreshAllowList.add(newRefresh);
    res.json({ token_type: 'Bearer', access_token: newAccess, refresh_token: newRefresh });
  } catch (err) {
    return res.status(401).json({ error: 'invalid_refresh_token', reason: err.message });
  }
});

// --- 5. Service-to-service token (OAuth2 client_credentials) -------------
// No user involved: a service proves itself with client_id + client_secret and
// gets a token scoped to what that service is allowed to call.
const SERVICE_CLIENTS = { 'svc-reporting': 'secret-abc' };
app.post('/token', (req, res) => {
  const { client_id: clientId, client_secret: clientSecret, grant_type: grantType } = req.body || {};
  if (grantType !== 'client_credentials') return res.status(400).json({ error: 'unsupported_grant_type' });
  if (SERVICE_CLIENTS[clientId] !== clientSecret) return res.status(401).json({ error: 'invalid_client' });
  const accessToken = signAccessToken({ sub: clientId, scope: 'service:read' });
  res.json({ token_type: 'Bearer', access_token: accessToken });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`auth demo listening on http://localhost:${PORT}`));

module.exports = app;
