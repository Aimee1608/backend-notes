'use strict';

// Toy in-memory data. A real app uses a database for users and a fast store
// (e.g. Redis) for the refresh-token allow-list so tokens can be revoked.

// Demo users. Passwords would be hashed (bcrypt/argon2) in production.
const users = [
  { id: 'u_1001', username: 'alice', password: 'password123', scopes: ['profile', 'admin'] },
  { id: 'u_1002', username: 'bob', password: 'password123', scopes: ['profile'] },
];

// Allow-list of currently valid refresh tokens. Keeping it lets us revoke a
// refresh token on logout or rotate it on every refresh.
const refreshAllowList = new Set();

function findUser(username, password) {
  return users.find((u) => u.username === username && u.password === password);
}

function findUserById(id) {
  return users.find((u) => u.id === id);
}

module.exports = { findUser, findUserById, refreshAllowList };
