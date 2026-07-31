# 预授权冻结成功，扣款失败——这笔钱怎么办

打车结束，平台发起扣款，失败了（卡片过期、账户余额不足、银行侧超时）。但预授权冻结已经成功——用户卡里的这笔钱被冻着，既没被扣走，也还给不了用户。

这是预授权支付特有的问题。

---

## 什么是预授权

预授权（Pre-Authorization）是一种"先冻结，后扣款"的支付方式，常见于：

- **打车/外卖**：下单时冻结预估费用，服务结束后按实际金额扣
- **酒店预订**：入住时冻结押金，退房时结算实际消费
- **租车**：取车时冻结一定额度，还车时按实际扣

和普通支付不同，预授权分两个阶段：
1. `授权（Authorize）`：冻结金额，不真正扣款
2. `完成（Capture）`：服务结束后，按实际金额扣款（≤ 冻结金额）

两个阶段可以相差几小时到几天，这个时间差就是问题的根源。

---

## Capture 失败的常见原因

- 卡片在冻结期间过期
- 用户账户余额在其他消费后不足（冻结只是预留，不是真的扣走）
- 银行侧超时或临时故障
- 预授权有效期过了（一般 7~30 天），再发 Capture 失败

---

## 失败后的处理路径

**第一步：区分"可重试"和"不可重试"错误**

```java
CaptureResult result = payChannel.capture(authCode, actualAmount);
if (result.isRetryable()) {
    // 临时错误（超时/网络），加入重试队列
    retryQueue.enqueue(orderId, result.getErrorCode(), retryCount + 1);
} else {
    // 不可重试（卡过期/余额不足/授权过期）
    handleCaptureFailure(orderId, result.getErrorCode());
}
```

不要对所有错误都重试——卡已过期这类错误，重试 100 次也没用，只会白白占用资源。

**第二步：不可重试时，主动取消预授权（Void/Release）**

冻结了但不能扣款，要主动通知银行解冻：

```java
void handleCaptureFailure(Long orderId, String errorCode) {
    // 通知银行/渠道释放冻结（Void Authorization）
    payChannel.void(order.getAuthCode());
    orderDao.updateStatus(orderId, PAYMENT_FAILED);

    // 通知用户支付失败，引导重新支付
    notificationService.sendPaymentFailed(order.getUserId(), orderId);
}
```

如果不主动 Void，冻结金额要等授权过期才自动释放（可能 7~30 天），这段时间用户的钱处于冻结状态，体验极差，还会来投诉。

**第三步：订单进入"待重新支付"状态**

向用户提供两个选项：
1. 换一张卡重新支付（生成新订单或复用原订单走新的支付流程）
2. 取消订单

---

## 预授权超时：时间到了还没 Capture

授权有效期通常是固定天数，到期前没有 Capture，授权自动失效。

打车/外卖通常当次结束就会 Capture，问题不大。酒店押金这类场景，住多天才结算，要注意：

- 入住第一天冻结的授权，到退房日可能已经接近或超过有效期
- 需要在到期前重新发起授权（Re-Authorization），续期冻结

这需要定时任务监控：

```java
@Scheduled(cron = "0 0 9 * * ?")  // 每天早上检查
public void checkPreAuthExpiry() {
    // 查找授权快过期（3天内）且还未 Capture 的订单
    List<Order> expiring = orderDao.findExpiringPreAuth(3);
    for (Order order : expiring) {
        // 重新发起授权续期
        payChannel.reAuthorize(order.getAuthCode(), order.getHoldAmount());
    }
}
```

---

## 两个容易忘的细节

**Capture 失败后必须主动 Void。** 不主动释放，冻结金额要等授权自动过期才能解冻，可能是 7 到 30 天。用户那边显示"可用余额少了 100 块"，但又没收到任何付款，很难解释。Void 的成本几乎为零，应该立刻做。

**区分"可重试"和"不可重试"的错误。** 卡过期、余额不足是确定性失败，重试没有意义；银行侧超时是临时性问题，重试有机会成功。两类错误混在一起无差别重试，既浪费也增加风险——余额不足还反复扣会被渠道风控标记。
