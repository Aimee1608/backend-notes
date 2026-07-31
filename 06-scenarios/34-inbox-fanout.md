# 消息量大，写扩散还是读扩散——接到这个需求先问清楚规模

做站内信、Feed 流之前，先问一个问题：**这个平台上，关注量最大的用户大概有多少粉丝？**

答案决定了架构方向。

---

## 写扩散（Fanout on Write）

用户 A 发了一条动态，系统立刻把这条消息写入所有关注者的收件箱：

```sql
-- A 发动态，假设 A 有 500 个粉丝
INSERT INTO inbox (user_id, message_id, created_at) 
VALUES 
  (follower1_id, messageId, now),
  (follower2_id, messageId, now),
  ...  -- 500 条
```

**优点**：读取时极快，直接按 `user_id` 查收件箱，不需要联表，分页简单。

**缺点**：大 V 发一条动态，可能写几百万条收件箱记录。写入慢、存储放大严重、如果是同步写更会卡住发布接口。

写扩散适合：**粉丝数量级在万级以下**的平台，写入压力可控。

---

## 读扩散（Fanout on Read）

用户打开收件箱时，系统去查"我关注的所有人"发的动态，聚合后展示：

```sql
-- 查我关注的人
SELECT followed_id FROM follow WHERE follower_id = ? 

-- 再去内容表查这些人的动态
SELECT * FROM post 
WHERE author_id IN (followed_id_list) 
ORDER BY created_at DESC 
LIMIT 20
```

**优点**：发布动态时无需写扩散，存储节省，大 V 发布不会产生写入风暴。

**缺点**：读取时计算量大，关注人数多时 `IN` 子句巨大，查询慢；实时性差，要维护缓存。

读扩散适合：**大 V 粉丝数量级在百万以上**的平台，重心是削减写入开销。

---

## 混合方案：实际系统的选择

单纯的读扩散或写扩散各有缺陷，主流大型平台（微博等）用混合方案：

- **普通用户**：写扩散。粉丝数量少，写入放大可接受，读取快。
- **大 V 用户**（粉丝数超过某个阈值，如 10 万）：读扩散。用户打开 Feed 时，在已有写扩散结果的基础上，再去查这些大 V 的最新动态，合并排序后展示。

```java
// 伪代码：混合拉取
List<Post> normalFeed = inboxDao.query(userId, page);   // 来自写扩散收件箱
List<Long> bigVIds = followDao.getBigVFollowing(userId);
List<Post> bigVFeed = postDao.queryLatest(bigVIds, after: lastReadTime); // 实时拉
return mergeSortByTime(normalFeed, bigVFeed);
```

缺点是合并排序增加了复杂度，大 V 关注数量多了也有性能压力，要限制"大 V 关注上限"或做缓存。

---

## 收件箱的数据结构

无论哪种方案，收件箱的存储通常用 Redis Sorted Set，score 是时间戳：

```
ZADD inbox:{userId} {timestamp} {messageId}
ZREVRANGE inbox:{userId} 0 19  // 拿最新 20 条
```

优点是天然排序、O(log N) 插入、范围查询快。缺点是内存占用，一般只保留最近 N 条（如最近 1000 条），超出的走数据库归档查询。

---

动手写代码前先量一下：平台最大粉丝数是多少，DAU 级别是多少，读写比是多少。这些数字决定了哪种方案的边界在哪里，不是技术偏好，是规模决定的。
