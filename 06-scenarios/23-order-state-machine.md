# 订单状态机——"已完成"的订单，怎么变成"已取消"的

客服来反馈：有用户的订单已经确认收货了，系统里显示"已取消"。

排查发现：运营侧的一个批量脚本，扫描了"超过 30 天未操作"的订单执行取消，没有判断当前状态，直接执行了 `UPDATE orders SET status = 'CANCELLED'`。

---

## 状态机的核心：不是所有转换都合法

订单状态不是随意可以改的变量，它有合法的流转路径：

```
待支付 → 已支付 → 待发货 → 已发货 → 已完成
         ↓           ↓
       已取消       已取消（发货前可取消）
```

`已完成 → 已取消` 这条路根本不应该存在。但如果代码里只做了 `order.setStatus(newStatus)` 而没有校验"当前状态是否允许此次转换"，任何代码都可以把订单改成任意状态。

---

## 状态守卫：定义允许的转换

最直接的做法是维护一张"允许转换表"：

```java
private static final Map<OrderStatus, Set<OrderStatus>> ALLOWED_TRANSITIONS = Map.of(
    OrderStatus.UNPAID,    Set.of(PAID, CANCELLED),
    OrderStatus.PAID,      Set.of(PENDING_SHIPMENT, CANCELLED),
    OrderStatus.PENDING_SHIPMENT, Set.of(SHIPPED),
    OrderStatus.SHIPPED,   Set.of(COMPLETED),
    OrderStatus.COMPLETED, Set.of(),   // 已完成，不允许任何转换
    OrderStatus.CANCELLED, Set.of()    // 终态，不允许转换
);

public void transition(Order order, OrderStatus newStatus) {
    Set<OrderStatus> allowed = ALLOWED_TRANSITIONS.getOrDefault(order.getStatus(), Set.of());
    if (!allowed.contains(newStatus)) {
        throw new IllegalStateTransitionException(
            String.format("订单 %s 不允许从 %s 转换为 %s", order.getId(), order.getStatus(), newStatus)
        );
    }
    order.setStatus(newStatus);
    orderDao.updateStatus(order.getId(), newStatus, order.getStatus()); // CAS 更新
}
```

所有状态变更必须走 `transition()` 方法，不允许直接赋值。这样任何非法转换在应用层就会抛异常，数据库层的 CAS 作为最后防线。

---

## 数据库层的 CAS

应用层守卫是第一关，数据库的 CAS 是第二关：

```sql
UPDATE orders
SET status = 'CANCELLED', updated_at = NOW()
WHERE id = ?
  AND status IN ('UNPAID', 'PAID')  -- 只有这两个状态允许取消
```

如果应用层代码绕过了状态守卫（比如那个批量脚本直接调 DAO），数据库的 WHERE 条件会拦住它——`已完成` 的订单根本匹配不到这个 WHERE，`affected rows = 0`，取消失败。

---

## 终态要格外保护

`已完成` 和 `已取消` 是终态——进入之后不能再变。

终态保护要单独处理，因为开发写代码时很容易漏掉"终态不能转换"这个约束。可以在状态守卫里显式标记：

```java
// 终态的允许转换集合为空，transition() 会自动拒绝
OrderStatus.COMPLETED, Set.of()
OrderStatus.CANCELLED, Set.of()
```

对于那个批量脚本的问题：正确写法是 `WHERE status IN ('UNPAID', 'PAID') AND last_updated_at < NOW() - INTERVAL 30 DAY`，明确只取允许取消的状态，而不是扫所有 30 天未操作的订单。

---

## 状态机文档和代码要一起维护

状态机图很容易在需求迭代中悄悄过时——代码加了新状态，文档没更新；或者文档定义了一个转换，代码里漏了。

比较实际的做法是让代码即文档：把 `ALLOWED_TRANSITIONS` 表暴露成接口，前端或运营工具可以查询某个订单当前允许哪些操作。这比维护一张独立的状态机图更不容易腐化。
