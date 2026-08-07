# 排行榜的两类需求，难度差了一个数量级

"做个排行榜"——产品说完这句话，你要先问清楚两件事：

**一是展示前 N 名的列表，还是要显示用户自己的排名？**

前 N 名列表很好做，自己的排名是另一个问题。

**二是用户量级是多少？**

几万和几千万，实现完全不同。

---

## 展示前 N 名：Redis ZSet 够了

```java
// 写入：用户得分更新
redis.zadd("rank:game", score, String.valueOf(userId));

// 读取：前 100 名（降序）
Set<ZSetOperations.TypedTuple<String>> top100 =
    redis.zrevrangeWithScores("rank:game", 0, 99);
```

`ZREVRANGE` 返回的是已排序结果，不需要在应用层排序，O(log N + K)。

展示时要做的只有：用 userId 批量查用户名、头像等信息，再拼到排名列表里。

分页也简单：第 2 页取 `ZREVRANGE rank:game 100 199`，以此类推。

---

## "我排第几名"：ZREVRANK

这比前 N 名列表多了一个场景：用户想知道自己的排名。

千万不要这样查：

```sql
SELECT COUNT(*) + 1 FROM rank WHERE score > (SELECT score FROM rank WHERE user_id = ?)
```

数据量大时，这是全表扫描，慢且不一定准（并发更新时）。

Redis 的 `ZREVRANK` 专为这个设计：

```java
// 用户在降序榜中的排名（0 表示第 1 名）
Long rank = redis.zrevrank("rank:game", String.valueOf(userId));
if (rank == null) {
    return -1; // 未上榜
}
return rank + 1; // 转成从 1 开始
```

时间复杂度 O(log N)，1 亿用户也是毫秒级。

---

## 附近排名："我的前后各 5 名"

这个需求很常见，实现也简单：

```java
long myRank = redis.zrevrank("rank:game", String.valueOf(userId)); // 从 0 开始
long start = Math.max(0, myRank - 5);
long end = myRank + 5;

Set<ZSetOperations.TypedTuple<String>> nearby =
    redis.zrevrangeWithScores("rank:game", start, end);
```

不需要多次查询，一次 `ZREVRANGE` 就拿到附近的所有人。

---

## 超大规模：ZSet 还撑得住吗

ZSet 每个成员约 64-80 字节。1 亿用户大约占 6-8 GB 内存，单台 Redis 能 hold 住，但做备份、主从同步时会有压力。

实用的分层方案：

- **全量 ZSet**：保存所有用户得分，用来查自己的排名（`ZREVRANK`）
- **榜单缓存**：定时（如每 5 分钟）从 ZSet 取前 1000 名写入独立缓存，页面展示时只读这份缓存

这样即使 ZSet 很大，页面展示的前 N 名都走小缓存，读取极快；排名查询走 `ZREVRANK`，O(log N) 不受影响。

---

## 榜单有效期和重置

周榜、月榜需要定时重置，别直接 `DEL`：

```java
// 重置周榜：重命名旧榜留存归档，新建空 key
String archiveKey = "rank:game:week:" + lastWeekId;
redis.rename("rank:game:weekly", archiveKey);
redis.expire(archiveKey, 30, TimeUnit.DAYS);
// 新的 weekly key 为空，自动从零开始
```

归档的榜单供"历史榜单"查询，不影响当前榜的性能。
