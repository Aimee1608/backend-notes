# 拼团差一人，两个人同时付款，结果团里来了6个人

## 你以为你会做

拼团需求来了，你觉得很简单：

1. 查一下团里还有几个空位
2. 有空位就把这个人加进去
3. 人数满了就成团

代码写出来大概长这样：

```java
// 看起来没问题？
Group group = groupDao.findById(groupId);
if (group.getCurrentCount() < group.getMaxCount()) {
    groupMemberDao.insert(userId, groupId);
    groupDao.updateCount(groupId, group.getCurrentCount() + 1);
}
```

5人团，已经4人，差1人。两个用户几乎同时点击"加入"，都查到 `currentCount = 4`，都通过了人数校验，都成功插入，团里变成6人。

**你以为你会做，但并发一来就出问题。**

---

## 为什么会超员？

查人数和写入不是原子操作，中间有时间窗口：

```
用户A：查到4人 → [时间窗口] → 写入 → currentCount=5 ✓
用户B：查到4人 → [时间窗口] → 写入 → currentCount=5 ✓（但实际已经5人了！）
```

两个请求都在对方写入之前完成了读操作，都以为自己是"第5个人"。

---

## 解法一：Redis INCR 原子计数

用 Redis 的原子自增，**先抢位置再加入**：

```lua
-- Lua 脚本，保证原子性
local key = "group:count:" .. groupId
local max = tonumber(ARGV[1])
local current = redis.call("INCR", key)
if current > max then
    redis.call("DECR", key)  -- 超员，回退
    return -1                 -- -1 表示团已满
end
return current               -- 返回抢到的位置编号
```

谁拿到位置，谁再写数据库。INCR 是原子操作，并发100个请求，也只有第1-5个能拿到有效位置。

---

## 解法二：数据库行锁

不想引入 Redis 依赖，也可以用数据库行锁：

```sql
-- 事务内先锁住这行
BEGIN;
SELECT * FROM group_info WHERE id = ? FOR UPDATE;  -- 行锁

-- 锁内判断人数
-- 如果 current_count < max_count，才允许加入
UPDATE group_info 
SET current_count = current_count + 1 
WHERE id = ? AND current_count < max_count;

-- affected rows = 0 → 团已满，回滚
COMMIT;
```

`FOR UPDATE` 让后来的请求在锁释放前阻塞，保证一次只有一个请求在修改人数。

---

## 不加锁 vs 加锁的差异

**不加锁**：用户A和用户B同时查到4人 → 两个都校验通过 → 两个都写入 → **结果 6 人团（超员）**

**加锁（Redis INCR）**：用户A INCR → 5，拿到位置写入 ✓；用户B INCR → 6，超员，DECR 回退 → **结果 5 人团（正确）**

---

## 两种方案怎么选？

| 方案 | 适用场景 | 注意点 |
|------|----------|--------|
| Redis INCR | 高并发、对延迟敏感 | Redis 挂了要有降级，计数和 DB 可能短暂不一致 |
| DB 行锁 | 中低并发、不想引入额外依赖 | 高并发下行锁竞争激烈，影响吞吐 |

团购通常在特定时段有流量峰值，推荐 Redis 方案，但要做好 Redis 和 DB 的一致性兜底（定期对账）。

---

## 根因就一句话

超员为什么防不住？因为"读人数 → 判断是否满 → 写加入记录"三步分开执行，并发时每一步都可能读到旧值。

解法只有一个：把"占位"压缩成单步原子操作。Redis INCR 或数据库 FOR UPDATE，选一个——超员必须在占位那一步消灭，后面再判断就晚了。
