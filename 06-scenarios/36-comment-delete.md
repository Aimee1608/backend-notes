# 删了父评论，子评论怎么处理——先想清楚用户看到的是什么

产品来问：用户举报了一条评论，审核通过后要删除它，但这条评论下面有 12 条回复，删除父评论后，这 12 条回复怎么办？

这不只是个数据库问题，首先是个产品问题：**用户看到的页面里，这 12 条回复还显示吗？**

答案决定了技术方案。

---

## 三种策略，各有适用场景

**策略一：级联删除**

父评论删除，子评论一并删除。

用于：违规内容管理。父评论是违规内容，子评论通常是对违规内容的回应，留着没有意义，且可能传播违规上下文。

```sql
DELETE FROM comment WHERE id = ? OR parent_id = ?
```

或者用软删除，给父和所有子都打删除标记：

```sql
UPDATE comment SET deleted = 1 WHERE id = ? OR parent_id = ?
```

**策略二：保留子评论，父评论显示"已删除"**

父评论打删除标，展示时替换为"该评论已被删除"或"原评论不可见"。子评论正常显示，但显示上下文中父评论是占位符。

用于：用户自行删除评论，或温和审核（评论本身没有严重违规，只是被举报内容不妥）。子评论是独立的用户内容，不应受父评论影响。

```java
// 展示时处理
if (comment.isDeleted()) {
    comment.setContent("该评论已删除");
    comment.setAuthorName(null);  // 不显示作者
}
// 子评论正常展示
```

**策略三：查询时过滤父评论，子评论挂到更高层**

实现最复杂，适合楼中楼结构（子评论不只一级）。父评论删除后，其子评论的展示位置上移一层，重新挂在祖父评论下。

普通业务场景用不到这个，过度复杂。

---

## 数据结构设计影响策略选择

评论表常见两种结构：

**邻接表**（存 `parent_id`）：

```sql
CREATE TABLE comment (
    id        BIGINT PRIMARY KEY,
    post_id   BIGINT NOT NULL,
    parent_id BIGINT,   -- NULL 表示顶层评论
    content   TEXT,
    deleted   TINYINT DEFAULT 0
);
```

查询子评论：`SELECT * FROM comment WHERE parent_id = ?`
递归查所有后代需要多次查询，或用递归 CTE（MySQL 8.0+）。

**闭包表**（存所有祖先-后代关系）：

```sql
CREATE TABLE comment_path (
    ancestor_id   BIGINT,
    descendant_id BIGINT
);
```

查所有后代：`SELECT descendant_id FROM comment_path WHERE ancestor_id = ?`

闭包表查询性能好，但删除时要同步维护路径表，实现稍复杂。二级评论场景邻接表够用，多级嵌套考虑闭包表。

---

## 审核删除 vs 用户自删

同一个删除操作，审核驱动和用户自行删除往往需要不同策略：

| 删除触发 | 推荐策略 |
|----------|----------|
| 审核违规 | 级联删除子评论 |
| 用户自行删除 | 软删父评论，保留子评论 |
| 管理员删除 | 业务决定，通常同审核 |

把删除类型记在删除操作的日志里，方便后续审计。
