# 并发点赞的计数设计：原子操作与最终对账

并发点赞有一类经典现象：压测时点了 50 次赞，最终计数却少了几个，而且稳定复现。

少掉的计数去哪了？

---

## 错误方案：读-改-写

```java
// 危险的写法
int count = articleDao.getLikeCount(articleId);
articleDao.updateLikeCount(articleId, count + 1);  // 点赞
```

并发时：线程 A 读到 50，线程 B 也读到 50，都写回 51。实际应该是 52，结果丢了一次点赞。

这是典型的 race condition，读-改-写在并发场景必须用原子操作替代。

---

## 原子计数：数据库层

```sql
UPDATE article SET like_count = like_count + 1 WHERE id = ?  -- 点赞
UPDATE article SET like_count = like_count - 1 WHERE id = ?  -- 取消点赞
```

`like_count = like_count + 1` 是数据库的原子操作，不存在并发丢失的问题。

但有两个问题没解决：**防重复点赞**和**精确防负数**。

---

## 防重复点赞

同一用户对同一内容只能点赞一次，需要单独记录"谁点了哪篇"：

```sql
CREATE TABLE user_like (
    user_id    BIGINT NOT NULL,
    article_id BIGINT NOT NULL,
    created_at DATETIME,
    PRIMARY KEY (user_id, article_id)  -- 唯一约束保证不重复
);
```

点赞流程：
1. 向 `user_like` 插入记录（主键冲突说明已点，返回"已点赞"）
2. 插入成功再 `like_count + 1`

取消点赞流程：
1. 删除 `user_like` 记录（不存在说明未点过，返回"未点赞"）
2. 删除成功再 `like_count - 1`

两步操作不是原子的，要在一个事务里：

```java
@Transactional
public void like(long userId, long articleId) {
    int affected = userLikeDao.insert(userId, articleId);  // 0 表示已点过
    if (affected > 0) {
        articleDao.incrementLike(articleId);
    }
}
```

---

## 高并发场景：Redis 计数

数据库原子操作在高并发下也会有锁竞争，热门内容每秒几千次点赞，`UPDATE` 会产生行锁等待。

更好的方案：Redis 原子计数 + 异步落库：

```java
// 点赞
public void like(long userId, long articleId) {
    // 用户级去重（Set 结构，sadd 返回 1 表示首次添加）
    long added = redis.sAdd("likes:" + articleId, String.valueOf(userId));
    if (added > 0) {
        redis.incr("like_count:" + articleId);
        // 发 MQ 事件，异步写 user_like 表
        mqProducer.send(new LikeEvent(userId, articleId, "LIKE"));
    }
}
```

Redis `SADD` 和 `INCR` 都是原子操作，耐并发。计数读取直接从 Redis 拿，实时性好。

异步写库时，MQ 消费幂等（用主键唯一约束兜底），延迟落库可接受。

---

## 计数最终对账

Redis 和数据库之间可能有差异（Redis 重启数据丢失、MQ 消费延迟）。定期对账：

定时任务按文章批量比对 `like_count` 字段和 `user_like` 表的真实 count，发现差异写告警并修正。对账不是替代方案，是最后一道兜底。
