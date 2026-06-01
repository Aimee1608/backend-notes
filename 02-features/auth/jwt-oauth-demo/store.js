'use strict';

// 玩具级的内存数据。真实应用会用数据库存用户,用快存储(如 Redis)
// 存 refresh token 的白名单,这样 token 才能被吊销。

// 演示用户。生产环境密码必须哈希(bcrypt/argon2)后存储。
const users = [
  { id: 'u_1001', username: 'alice', password: 'password123', scopes: ['profile', 'admin'] },
  { id: 'u_1002', username: 'bob', password: 'password123', scopes: ['profile'] },
];

// 当前有效的 refresh token 白名单。存一份,才能在登出时吊销、
// 或在每次刷新时轮转。
const refreshAllowList = new Set();

function findUser(username, password) {
  return users.find((u) => u.username === username && u.password === password);
}

function findUserById(id) {
  return users.find((u) => u.id === id);
}

module.exports = { findUser, findUserById, refreshAllowList };
