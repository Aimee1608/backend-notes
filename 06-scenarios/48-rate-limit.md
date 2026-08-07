# 日志里出现了一个用户一分钟请求了 800 次

告警是凌晨 2 点触发的，同一个 user_id，密集请求同一个接口，间隔均匀——显然是脚本。

没有限流，请求全部打到数据库，MySQL 慢查询日志满了。

---

## 固定窗口的边界漏洞

最简单的限流：每分钟最多 100 次，超了拒绝。

```java
String key = "limit:" + userId + ":" + (System.currentTimeMillis() / 60_000);
long count = redis.incr(key);
redis.expire(key, 60, TimeUnit.SECONDS);
if (count > 100) throw new TooManyRequestsException();
```

这有个边界问题：59:59 发了 100 次，60:00 计数器归零，60:01 又能发 100 次。在分钟切换的 2 秒内可以发 200 次请求，是设定上限的两倍。

---

## 令牌桶：允许适度突发

令牌桶以固定速率往桶里放令牌，请求消耗令牌，桶满后新令牌溢出不累积。

特点：**平时积累令牌，短时突发可以消耗积累，但长期速率不超过补充速率。**

单机场景用 Guava：

```java
// 每秒允许 10 个请求（令牌补充速率）
RateLimiter limiter = RateLimiter.create(10.0);

public void handleRequest() {
    if (!limiter.tryAcquire()) {
        throw new TooManyRequestsException();
    }
    // 处理请求
}
```

多实例部署时，Guava 的令牌桶是单机的，各实例独立计数。100 台机器，每台限 10 QPS，实际能放过 1000 QPS——需要分布式限流。

---

## 分布式滑动窗口：Redis + Sorted Set

精确的分布式限流，用 Redis Sorted Set 实现滑动窗口：

```java
public boolean isAllowed(String userId, int maxRequests, long windowMs) {
    String key = "ratelimit:" + userId;
    long now = System.currentTimeMillis();
    long windowStart = now - windowMs;

    // Lua 脚本保证原子性
    String script = """
        local key = KEYS[1]
        local now = tonumber(ARGV[1])
        local windowStart = tonumber(ARGV[2])
        local maxRequests = tonumber(ARGV[3])
        
        redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)
        local count = redis.call('ZCARD', key)
        if count < maxRequests then
            redis.call('ZADD', key, now, now)
            redis.call('EXPIRE', key, math.ceil((now - windowStart) / 1000) + 1)
            return 1
        end
        return 0
        """;

    Long result = redis.execute(script, List.of(key),
        String.valueOf(now), String.valueOf(windowStart), String.valueOf(maxRequests));
    return Long.valueOf(1).equals(result);
}
```

Lua 脚本保证"查计数 + 写入"的原子性，避免并发时多个请求同时判断"未超限"都通过。

---

## 限流后的响应

不要只返回 500 或让请求超时挂着，正确做法：

```java
// HTTP 429 Too Many Requests
response.setStatus(429);
response.setHeader("Retry-After", "60");  // 告诉客户端 60 秒后重试
response.getWriter().write("{\"error\":\"too_many_requests\",\"retryAfter\":60}");
```

`Retry-After` 头让调用方知道等多久，合法的自动化客户端会尊重这个响应，减少无效重试。

---

## 限流的维度

| 维度 | key 格式 | 适合拦截 |
|------|---------|---------|
| 用户 | `limit:user:{userId}` | 单用户滥用 |
| IP | `limit:ip:{ip}` | 未登录刷接口 |
| 接口 + 用户 | `limit:api:{path}:{userId}` | 针对特定接口保护 |
| 全局接口 | `limit:api:{path}` | 保护后端总吞吐 |

多维度叠加使用，先过用户级，再过 IP 级，再过接口总量——任何一层超限就拒绝。
