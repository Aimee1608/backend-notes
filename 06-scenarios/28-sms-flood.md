# 短信账单上多了 2000 块，被人刷验证码了

运营发现短信费用突然多了一大笔，排查后发现：有人写了个脚本，对着注册接口循环请求，每次填不同的手机号（或者同一个号频繁请求），批量触发了几千条验证码短信。

短信按条收费，一毛到几毛不等。一个没有限流的验证码接口，是实打实的烧钱漏洞。

---

## 频率限制：几道防线叠加

单靠一道防线很容易被绕过，需要多个维度叠加：

**第一道：同一手机号冷却期**

发出验证码后，60 秒内不允许对同一号码再次发送：

```java
String key = "sms:cooldown:" + phone;
Boolean isFirst = redis.setIfAbsent(key, "1", 60, TimeUnit.SECONDS);
if (!Boolean.TRUE.equals(isFirst)) {
    throw new BizException("发送太频繁，请 60 秒后再试");
}
```

**第二道：同一手机号日发送上限**

每天对同一号码最多发 5 条：

```java
String dailyKey = "sms:daily:" + phone + ":" + LocalDate.now();
long count = redis.increment(dailyKey);
redis.expire(dailyKey, 24 * 3600, TimeUnit.SECONDS);
if (count > 5) {
    throw new BizException("今日验证码发送次数已达上限");
}
```

**第三道：同一 IP 滑动窗口**

短时间内同一 IP 请求验证码次数过多，说明是批量脚本：

```java
String ipKey = "sms:ip:" + clientIp + ":" + (System.currentTimeMillis() / 60_000); // 按分钟分桶
long ipCount = redis.increment(ipKey);
redis.expire(ipKey, 120, TimeUnit.SECONDS);
if (ipCount > 10) {
    // 一分钟内超过 10 次，触发人机验证或临时封禁
    return RequireCaptchaResponse.blocked(clientIp);
}
```

---

## 滑动窗口 vs 固定窗口

上面按分钟分桶是固定窗口，有个边界问题：59:59 发了 10 条，60:00 计数器清零，60:01 又能发 10 条——在分钟边界处可以在 2 秒内发 20 条。

滑动窗口更精确，用 Redis Sorted Set 实现：

```java
String key = "sms:sliding:" + clientIp;
long now = System.currentTimeMillis();
long windowStart = now - 60_000; // 1分钟窗口

// 清理过期的请求记录
redis.zRemRangeByScore(key, 0, windowStart);
// 加入本次请求
redis.zAdd(key, now, now + "-" + UUID.randomUUID());
// 统计窗口内的请求数
long countInWindow = redis.zCount(key, windowStart, now);

if (countInWindow > 10) {
    throw new RateLimitException("请求过于频繁");
}
redis.expire(key, 120, TimeUnit.SECONDS);
```

高频接口用滑动窗口，普通场景用固定窗口（实现简单，误差可接受）。

---

## 图形验证码的时机

验证码本身不是防刷的第一手段，是在其他防线失效后的升级响应：

- 正常用户：无感知，直接发短信
- IP 异常（单 IP 多号）：弹图形验证码
- 手机号日上限触达：弹图形验证码 + 人工核实提示
- IP 被封禁：直接拒绝，不弹验证码（避免验证码接口也被打）

把图形验证码作为必填项会伤害正常用户体验；把它作为风险升级后的响应，是更合理的用法。

---

## 短信网关侧的兜底

运营商侧也有发送频控，但那是最后一道：运营商拒绝了，短信没发出去，但接口调用可能已经扣费了（取决于运营商计费逻辑）。

平台侧的频控是自己的钱包，要自己守。网关侧的限制是备用兜底，不是主要防线。

三道防线 — 号码冷却 + 号码日上限 + IP 滑动窗口 — 覆盖住大多数刷验证码的场景，图形验证码在异常时动态插入，网关侧备用兜底。
