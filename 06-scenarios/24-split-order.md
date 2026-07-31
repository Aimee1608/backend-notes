# 拆单之后，用户问：我的订单到底是什么状态

一笔订单拆成三个子单，第一个已发货、第二个已签收、第三个因为仓库缺货还在待发货——用户在 App 上看到的父订单状态是什么？

你以为这个问题很简单：把三个子单状态汇总一下，谁最落后就显示谁。

但"谁最落后"这个逻辑，细想就不对。

---

## 直接取最低状态，会出什么问题

最直接的实现：取所有子单中状态最靠前（最早）的那个展示给用户。

```java
OrderStatus parentStatus = childOrders.stream()
    .map(Order::getStatus)
    .min(Comparator.comparingInt(OrderStatus::getStep))
    .orElse(UNKNOWN);
```

场景一：子单1已完成，子单2缺货待补。"最低状态"是待发货，父订单显示"待发货"——但用户已经拿到了一部分货，看到"待发货"会认为全部商品都没发。

场景二：子单1已取消（用户主动退了），子单2已完成。"最低状态"是已取消，父订单显示"已取消"——但用户实际上已经收到了部分商品。

状态聚合不是取最小值，是按照业务语义来定规则。

---

## 状态聚合规则要显式定义

常见的聚合逻辑：

```java
OrderStatus aggregateStatus(List<OrderStatus> childStatuses) {
    // 有任何一个还在途，整体就算"进行中"
    if (childStatuses.contains(PENDING_SHIPMENT) || childStatuses.contains(SHIPPED)) {
        return PARTIALLY_SHIPPED; // 部分发货中
    }
    // 全部完成（含部分取消）
    boolean allDone = childStatuses.stream()
        .allMatch(s -> s == COMPLETED || s == CANCELLED);
    if (allDone) {
        boolean anyCompleted = childStatuses.contains(COMPLETED);
        return anyCompleted ? COMPLETED : CANCELLED;
    }
    // 全部取消
    if (childStatuses.stream().allMatch(s -> s == CANCELLED)) {
        return CANCELLED;
    }
    return PAID; // 还没开始发货
}
```

关键点：`PARTIALLY_SHIPPED`（部分发货中）这个中间状态是设计出来的，不是直接从子单状态映射来的。父订单有自己的状态集合，和子单的状态集合不完全重合。

---

## 子单缺货的处理路径

子单缺货（仓库确认无法发货）有两种处理方式，取决于业务策略：

**自动取消缺货子单**：系统自动取消该子单，退款给用户，父订单更新聚合状态。适合商品之间独立、用户可以接受部分履约的场景。

**等待补货**：子单保持"待发货"状态，等运营确认补货时间后通知用户。父订单显示"部分发货中，还有商品等待补货"，需要额外的提示文案。

两种方式都合理，关键是要有明确的超时机制——缺货子单不能无限期挂着，要设一个最长等待时间，到期自动取消并退款。

---

## 父子订单的数据一致性

父订单状态是从子单聚合出来的，聚合的时机有两种：

**实时聚合**：每次查询父订单时，临时读取所有子单状态算出来。实时性好，但如果子单数量多，每次查询都需要额外的数据库请求。

**事件驱动更新**：子单状态变更时，发送事件，触发父订单状态重新计算并写入数据库。读取时直接取字段值，无需实时聚合。

后者更常用，但要注意事件乱序——子单状态可能在同一时间并发更新，父订单的聚合逻辑要能处理乱序到来的事件（比如用版本号或者重新读所有子单重新计算，而不是增量更新）。
