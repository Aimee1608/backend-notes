# 部分发货：三个包裹签收了两个，整单算完成了吗

实物商品拆单发货是常态——仓库不同、供应商不同、商品重量限制……一笔订单三个包裹，用户陆续签收。

问题来了：签收了两个，第三个还在途，整单状态要写什么？

---

## 整单状态不等于子单状态的简单映射

把子单状态汇总给父订单，听起来直觉上是"谁最慢就显示谁"，但这个逻辑放在完成条件上会有歧义。

"已完成"意味着什么？

- **所有子单都完成**：最严格的定义。只要还有一个包裹没签收，整单不算完成。
- **主要履约已完成**：核心商品发出并签收，附赠品/赠品还在路上，整单可视为完成。
- **用户主动确认**：用户点击"全部收到"，无论子单状态如何。

三种定义都有业务场景，选哪个要提前决定，不能等上线后再改——因为这影响到售后、评价、结算，牵一发动全身。

---

## 聚合算法：各状态组合的映射表

用穷举法把所有组合的结果定义清楚，比写一堆 if-else 更可维护：

| 子单状态组合 | 父订单状态 |
|------------|-----------|
| 全部 COMPLETED | COMPLETED（已完成）|
| 全部 CANCELLED | CANCELLED（已取消）|
| 部分 COMPLETED + 部分 CANCELLED | PARTIALLY_COMPLETED（部分完成）|
| 有任意 SHIPPED | PARTIALLY_SHIPPED（部分配送中）|
| 有任意 PENDING_SHIPMENT，无 SHIPPED | PENDING_SHIPMENT（待发货）|
| 有任意 EXCEPTION（异常）| EXCEPTION（需处理）|

```java
OrderStatus aggregate(List<OrderStatus> statuses) {
    if (statuses.stream().allMatch(s -> s == COMPLETED)) return COMPLETED;
    if (statuses.stream().allMatch(s -> s == CANCELLED)) return CANCELLED;
    if (statuses.stream().allMatch(s -> s == COMPLETED || s == CANCELLED)) return PARTIALLY_COMPLETED;
    if (statuses.contains(EXCEPTION)) return EXCEPTION;
    if (statuses.contains(SHIPPED)) return PARTIALLY_SHIPPED;
    return PENDING_SHIPMENT;
}
```

---

## 超时自动完成

用户签收了却没点"确认收货"（或者 App 都没打开），快递已到站还在站点存放——这类订单不能永远停在"已签收待确认"状态。

标准做法：快递物流回传"已签收"后，启动超时计时（通常 7-15 天），到期自动触发"确认收货"，订单转为完成状态，释放评价权限。

超时触发要对每个子单分别计时，而不是等所有子单都"已签收"才开始整体计时——先到的子单先开计时，签收了就可以评价那件商品，不用等最后一个包裹。

---

## 完成触发的后续动作

"已完成"不只是改一个字段，它触发的事情很多：

- 解冻资金，结算给商家
- 开启评价窗口（给每个子单对应的商品评价）
- 关闭退货窗口（超过退货期）
- 积分/返现到账

这些后续动作里，"结算给商家"是不可逆的，所以完成条件的定义格外重要。如果因为状态聚合逻辑错误把未全部履约的订单算成了完成，资金已经结算出去，追回来很麻烦。

宁可晚一点完成，不要早了。
