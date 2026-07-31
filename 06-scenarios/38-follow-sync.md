# 互关之后，一方取消，另一方的状态没更新

A 和 B 互相关注，UI 上都显示"互相关注"。

A 取消了对 B 的关注，A 那边显示变成了"已关注"（单向），但 B 打开 A 的主页，居然还显示"互相关注"。

数据没同步，B 看到的是错的。

---

## 关注关系是两条单向记录

很多人第一反应：是不是"互关"字段没更新？

实际上，设计合理的关注系统里没有"互关字段"——互关是两条单向关系叠加的结果，不是独立存储的状态：

```sql
CREATE TABLE follow (
    follower_id   BIGINT NOT NULL,   -- 谁关注了
    followed_id   BIGINT NOT NULL,   -- 被关注的人
    created_at    DATETIME,
    PRIMARY KEY (follower_id, followed_id)
);
```

A 关注 B：`(follower_id=A, followed_id=B)` 一条记录
B 关注 A：`(follower_id=B, followed_id=A)` 一条记录

"A 和 B 是否互关"= 这两条记录是否都存在。没有单独的"互关"字段。

---

## 根因：UI 层判断互关时用了缓存

A 取消关注 B，删除了 `(A, B)` 这条记录。

B 的页面"查看 A 的主页"时展示的互关状态，是从某处缓存里读的，缓存没有失效。

修复思路：**A 取消关注时，主动失效 B 视角里与 A 相关的缓存**。

```java
@Transactional
public void unfollow(long followerId, long followedId) {
    followDao.delete(followerId, followedId);

    // 失效双方的关系缓存
    cacheManager.evict("follow_status:" + followerId + ":" + followedId);
    cacheManager.evict("follow_status:" + followedId + ":" + followerId);
}
```

关键点：`follow_status:B:A` 这个 key 描述的是"B 关注 A、且 A 关注 B（互关）"的状态，A 取消关注 B 时，这个 key 也要失效，因为互关状态已经改变。

---

## 查关注状态的正确姿势

展示"A 和 B 的关系状态"时，应该同时查两个方向：

```java
public FollowStatus getFollowStatus(long viewerId, long targetId) {
    boolean iFollow = followDao.exists(viewerId, targetId);
    boolean theyFollow = followDao.exists(targetId, viewerId);

    if (iFollow && theyFollow) return FollowStatus.MUTUAL;
    if (iFollow) return FollowStatus.FOLLOWING;
    if (theyFollow) return FollowStatus.FOLLOWER;
    return FollowStatus.NONE;
}
```

缓存这个结果时，key 要同时涉及两个方向：`follow_status:{min(A,B)}:{max(A,B)}`，用较小 ID 在前、较大 ID 在后排序，保证 A 看 B 和 B 看 A 命中同一个缓存 key，任何一方的关注变化都只需要失效一个 key。

---

## 关注数计数

粉丝数（被关注数）是高频读取的字段，通常单独维护计数：

```sql
CREATE TABLE user_stat (
    user_id          BIGINT PRIMARY KEY,
    following_count  INT DEFAULT 0,   -- 我关注了多少人
    follower_count   INT DEFAULT 0    -- 有多少人关注我
);
```

A 关注 B 时：A 的 `following_count + 1`，B 的 `follower_count + 1`。
A 取消关注 B 时：A 的 `following_count - 1`，B 的 `follower_count - 1`。

这两步要和 `follow` 表的写入放在同一个事务里，否则计数和关系记录不一致。数量级大时也可以用 Redis 原子计数 + 异步落库，原理同点赞计数。
