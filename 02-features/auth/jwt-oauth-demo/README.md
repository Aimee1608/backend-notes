# jwt-oauth-demo

一个最小可运行的鉴权 demo,演示 **JWT + OAuth 2.0** 的核心:access/refresh token、token 刷新与轮转、scope 权限校验、服务间鉴权。

> 纯教学用途,基于公开标准(OAuth 2.0 / RFC 6749、JWT / RFC 7519)。密码明文、密钥硬编码等**仅为演示**,生产环境别这么干(见代码注释)。

## 跑起来

```bash
npm install
npm start
# auth demo listening on http://localhost:3000
```

## 试一试(curl)

### 1. 登录,拿 token
```bash
curl -s -X POST http://localhost:3000/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"password123"}'
# -> { "token_type":"Bearer", "access_token":"...", "refresh_token":"..." }
```

### 2. 用 access token 访问受保护接口
```bash
TOKEN=<上一步的 access_token>
curl -s http://localhost:3000/profile -H "Authorization: Bearer $TOKEN"
# -> { "id":"u_1001", "username":"alice", "scopes":["profile","admin"] }
```

### 3. 访问需要 admin 权限的接口(授权 ≠ 认证)
```bash
curl -s http://localhost:3000/admin -H "Authorization: Bearer $TOKEN"
# alice 有 admin scope -> 200;换成 bob 登录则 -> 403 insufficient_scope
```

### 4. access token 过期后,用 refresh token 续期
```bash
curl -s -X POST http://localhost:3000/refresh \
  -H 'Content-Type: application/json' \
  -d '{"refresh_token":"<refresh_token>"}'
# -> 一对新的 access/refresh token(旧 refresh 作废 = 轮转)
```

### 5. 服务间鉴权(无用户,client_credentials)
```bash
curl -s -X POST http://localhost:3000/token \
  -H 'Content-Type: application/json' \
  -d '{"grant_type":"client_credentials","client_id":"svc-reporting","client_secret":"secret-abc"}'
# -> 一个 scope 为 service:read 的 access token
```

## 文件结构
- `auth.js` — JWT 签发 / 验签(access + refresh)
- `store.js` — 模拟用户 & refresh token allow-list
- `server.js` — 路由:login / profile / admin / refresh / token

## 对应笔记
见上层目录 [`../README.md`](../README.md)。
