'use strict';

// Core JWT helpers. This mirrors the OAuth 2.0 token model (RFC 6749): a
// short-lived access token carried on every request, plus a longer-lived
// refresh token used only to mint new access tokens.

const jwt = require('jsonwebtoken');

// In a real service these come from a secret manager / env, never hard-coded.
const ACCESS_SECRET = process.env.ACCESS_SECRET || 'dev-access-secret-change-me';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'dev-refresh-secret-change-me';

// Access tokens are short-lived on purpose: if one leaks, the abuse window is
// small. The client silently swaps it for a new one using the refresh token.
const ACCESS_TTL = '15m';
// Refresh tokens live longer but are used rarely (only at /refresh).
const REFRESH_TTL = '7d';

function signAccessToken(payload) {
  // `payload` carries identity (sub) and authorization data (scope).
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_TTL });
}

function signRefreshToken(payload) {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_TTL });
}

function verifyAccessToken(token) {
  // Throws if expired or tampered with; the caller turns that into a 401.
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
