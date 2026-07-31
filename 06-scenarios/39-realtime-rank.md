# 你以为热榜就是 ORDER BY，做完才发现是另一回事

接到需求：展示实时热榜，按热度降序，支持分页，每分钟刷新。

第一反应：`SELECT id, score FROM post ORDER BY score DESC LIMIT 20`，不就完了？

上线之后，这条 SQL 成了最慢的查询，P99 超过 3 秒，CPU 飙高。

---

## 为什么 ORDER BY score 很慢

数据量到百万行时，`ORDER BY score` 即使有索引，每次请求都要走索引扫描 + 回表，结果集大、排序代价高。

更致命的是：热榜查询通常是高并发场景，每个用户刷新都打一次 DB，几百 QPS 都扛不住。

---

## Redis Sorted Set：为排名而生

Redis Sorted Set（ZSet）是专门为排名场景设计的数据结构：

- 每个成员带一个 score（浮点数）
- 天然按 score 排序
- 范围查询 O(log N)
- 取前 N 名：`ZREVRANGE` 或 `ZREVRANGEBYSCORE`

```java
// 帖子热度更新（每次点赞/评论/分享时调用）
redis.zadd("hot_rank", newScore, String.valueOf(postId));

// 查热榜前 20
Set<ZSetOperations.TypedTuple<String>> top20 = 
    redis.zrevrangeWithScores("hot_rank", 0, 19);
```

读热榜不走 DB，全在内存里，毫秒级响应，QPS 轻松上万。

---

## 热度分如何计算

热度分不只是点赞数，通常是一个加权公式：

```
score = likeCount * w1 + commentCount * w2 + shareCount * w3 + decayFactor(time)
```

时间衰减确保老内容不会永远霸榜。常见衰减方式：

```java
// Hacker News 风格的时间衰减
double score = (likeCount + commentCount * 2) / Math.pow(ageInHours + 2, 1.5);
```

这个分不是静态的，每次互动都要重算并更新 ZSet：

```java
public void onLike(long postId) {
    double newScore = calcScore(postId);  // 重新计算热度分
    redis.zadd("hot_rank", newScore, String.valueOf(postId));
}
```

---

## 实时更新 vs 定时刷新

**实时更新**：每次互动（点赞、评论）立刻更新 ZSet score。
- 优点：热榜数据实时
- 缺点：热门内容每秒几十次更新，ZSet 写入压力大；如果要全局重算 score（带时间衰减），实时无法做到

**定时刷新**：定时任务（如每分钟）批量重算所有活跃内容的 score，整批写入 ZSet。
- 优点：计算解耦，支持复杂分值公式，热榜对外表现稳定
- 缺点：最多延迟一个刷新周期

实际系统通常组合：互动事件实时更新 ZSet（`ZINCRBY` 累加点击数），另有定时任务按完整公式（含时间衰减）重算 score 并覆盖写入。

---

## 榜单分区

不同维度的榜需要不同的 ZSet key：

```
hot_rank:global          -- 全站热榜
hot_rank:cat:tech        -- 科技分类热榜
hot_rank:region:beijing  -- 北京地区热榜
```

榜单多了，ZSet 的总内存会增长。每个榜只保留前 N 名（如 1000），定期用 `ZREMRANGEBYRANK` 清理长尾：

```java
redis.zremrangeByRank("hot_rank:global", 0, -(1001));  // 只保留前 1000
```

---

热榜看起来是查询问题，实际是缓存更新问题。ZSet 让读变快只是第一步，分值设计和更新策略才是让榜单"好用"的关键。
