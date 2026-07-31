# 多设备登录——踢下线这件事，比想象中难做

手机 A 上登录着账号，在手机 B 上重新登录（同一账号），按照产品规则，手机 A 应该被踢下线。

手机 A 现在是什么状态？

如果是用户刚好在 A 上改了收货地址，改完点保存，请求打到服务器——Token 已经失效了，但 App 还以为是登录状态，这次修改是成功还是失败？

---

## Token 失效的两种方式

**短期 Token + 不可撤销**：JWT 最常见的用法，Token 里带过期时间，服务端无状态，不维护任何 Token 状态。过期了自动失效，但在过期前不能主动撤销。

踢下线时，只能等 A 的 Token 自然过期（可能还有几十分钟有效期），这期间 A 仍然可以正常操作。

**Token 持久化 + 可撤销**：服务端记录每个 Token 的状态，登录时生成、登出/踢下线时标记为无效。每次请求都校验 Token 是否仍有效。

```java
// 登录时
String token = UUID.randomUUID().toString();
redisTemplate.set("token:" + token, userId, 7, TimeUnit.DAYS);

// B 设备登录，踢 A 的 Token
String oldToken = userDao.getActiveToken(userId);
redisTemplate.delete("token:" + oldToken);
userDao.updateActiveToken(userId, newToken);

// A 的请求过来，校验 Token
String storedUserId = redisTemplate.get("token:" + token);
if (storedUserId == null) {
    throw new UnauthorizedException("登录已失效，请重新登录");
}
```

可撤销 Token 的代价是每次请求都要查 Redis，但精确踢下线必须走这条路。

---

## 踢下线通知：实时 vs 下次请求

用户在 A 设备上被踢了，有两种感知方式：

**下次请求时感知**：A 上的操作正常进行，发请求服务端校验 Token 失效，返回 401，App 跳到登录页。这是最简单的实现，但用户可能在被踢之后继续操作了一段时间，结果那些操作全部失败，体验不好。

**实时推送通知**：服务端踢下线的同时，通过长连接（WebSocket）或推送（APNs/FCM）通知 A 设备。A 收到通知后，主动清除本地登录状态，提示用户"您的账号已在其他设备登录"。

实时推送的前提是有长连接通道，实现更复杂，但体验更好——用户在 A 上的操作可以在失效前保存，失效后明确提示而不是让请求默默失败。

---

## 多 Token 场景：哪些踢，哪些不踢

不同设备的 Token 不一定都要踢。产品策略有几种：

| 策略 | 说明 |
|------|------|
| 同类型单设备 | 手机 A 登录踢掉手机 B，但平板、PC 不受影响 |
| 全设备踢除 | 新设备登录，所有已登录设备全部失效 |
| 保留指定设备 | 用户可以在安全设置里管理活跃设备，手动踢除 |

实现时，Token 里要带设备类型或设备 ID，服务端可以按维度控制：

```java
// 只踢同类型设备的 Token
String key = "token:active:" + userId + ":" + deviceType;
String oldToken = redisTemplate.get(key);
if (oldToken != null) {
    redisTemplate.delete("token:" + oldToken); // 让旧 Token 失效
}
redisTemplate.set(key, newToken);
```

---

## 被踢下线后的本地数据

App 在本地可能缓存了用户数据（草稿、未同步的操作）。被踢下线后，这些数据的处理是个用户体验问题：

- 未提交的草稿应该保留，让用户重新登录后找回（存本地，不依赖登录状态）
- 已提交但失败的操作（因为 Token 失效），App 应该明确提示，而不是静默丢弃
- 不要在踢下线时清除所有本地数据——用户可能很快在同设备重新登录，数据丢失体验极差

实时踢下线通知的价值之一就是让 App 有机会在清除登录状态之前，先把未保存的数据处理掉。
