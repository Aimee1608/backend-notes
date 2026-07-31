# 砍价砍到负数，这个坑比想象中更常见

有人用砍价活动拿到了一件"负 12 元"的商品。

商品定价 100 元，好友帮砍一刀，砍完多少算多少，砍到 0 就免费拿走——这个活动没有任何复杂逻辑，出事的地方在代码里，不在规则里。

---

## 哪里出了问题

先看一个简化版的砍价实现：

```java
BigDecimal current = bargainDao.getPrice(itemId);      // 当前价格
BigDecimal cut = generateRandomCut();                   // 随机砍多少
BigDecimal newPrice = current.subtract(cut);            // 算新价格
bargainDao.updatePrice(itemId, newPrice);               // 写回去
```

两个问题：

**问题一：没做边界校验。** `generateRandomCut()` 返回的值如果比 `current` 还大，`newPrice` 就成了负数。一个没有 `max(newPrice, 0)` 保底的实现，砍价到负数是迟早的事。

**问题二：三步不是原子操作。** 读价格 → 计算 → 写回，中间有时间窗口。两个好友同时砍，都读到当前价格是 30，A 砍了 20 写回 10，B 也砍了 20 写回 10。实际只砍了 20，但用户以为砍了 40。

---

## 边界校验：最后一刀不能过底

最简单也最容易漏：新价格不能低于 0，也不能低于活动设定的最低价（有些活动底价是 1 分，不是免费）。

```java
BigDecimal newPrice = current.subtract(cut);
BigDecimal minPrice = bargainItem.getMinPrice();   // 比如 0.01
if (newPrice.compareTo(minPrice) < 0) {
    // 最后一刀：只砍到底价，不能再低
    newPrice = minPrice;
}
```

最后一刀的处理还有另一个场景要想：刚好砍到 0 的瞬间，多个人同时提交"最后一刀"，都以为自己砍完了，谁算成功？

---

## 并发保护：用数据库乐观锁

砍价场景的并发量一般不高（毕竟每个活动的参与人数有限），数据库乐观锁够用：

```sql
-- 表结构加 version 字段
UPDATE bargain_item
SET current_price = ?, version = version + 1
WHERE id = ? AND version = ? AND current_price = ?
```

Java 侧：

```java
int rows = bargainDao.updateWithVersion(itemId, newPrice, oldVersion, oldPrice);
if (rows == 0) {
    // 被别的请求抢先，重试或提示"手慢了"
    throw new BizException("砍价太激烈，请稍后再试");
}
```

`affected rows = 0` 说明读到的 version 已经过期，拒绝这次更新。每个砍价请求串行化通过乐观锁，不会互相覆盖。

---

## 一人只能砍一次

砍价活动通常有"每人只能帮砍一次"的限制，不做这个限制的话，一个人循环调接口可以把价格砍到 0。

校验放在同一事务里：

```java
// 先查有没有砍过
boolean hasCut = bargainLogDao.exists(itemId, helperId);
if (hasCut) {
    throw new BizException("你已经帮过 TA 砍过了");
}
// 写砍价记录（有唯一索引：item_id + helper_id）
bargainLogDao.insert(itemId, helperId, cutAmount);
// 再更新价格
bargainDao.updateWithVersion(itemId, newPrice, oldVersion, oldPrice);
```

`bargain_log` 表在 `(item_id, helper_id)` 上加唯一索引，即使并发请求绕过了应用层校验，数据库唯一键冲突也能兜底。

---

边界校验和乐观锁，一个防"砍多了"，一个防"被覆盖"，两件事各自独立，少任何一件都有漏洞。加上唯一索引兜住"每人只砍一次"，砍价逻辑才算写完。
