# 钱退了，订单还是"退款中"——退款为什么不能只靠回调

退款这件事，用户侧和系统侧经常不同步。

用户银行卡已到账，订单系统还显示"退款处理中"；客服接到投诉，开发去查，发现退款早就成功了——支付宝的回调发出来了，但没有送达。

---

## 退款是异步的

发起退款 ≠ 退款完成。

调支付宝/微信退款接口，返回的是"退款申请已受理"，不是"钱已到账"。退款到账需要 1-7 个工作日（不同银行不同），渠道在退款完成后会主动回调平台通知结果。

问题是：回调是不可靠的。网络超时、平台服务重启、回调 URL 配置错误……任何一个环节出问题，回调就丢了。

---

## 回调为什么不可靠

退款回调的失败原因五花八门：平台服务这段时间正好在重启、回调 URL 配置改过但没同步到渠道、渠道侧发送超时重试用尽……任何一个环节出问题，回调就没了。

渠道不会因为你没收到就反复重试——通常最多几次，发完就算。如果那几次全丢，退款状态就永久停在"处理中"，除非有人主动去查。

---

## 主动查询 + 被动回调结合

两件事同时做：

**主动查询**：定时任务扫"退款中"状态超过一定时间的记录，主动调渠道查询退款结果。

```java
// 扫退款中且超过 10 分钟未更新的记录
List<RefundRecord> pending = refundDao.findPendingTimeout(10);
for (RefundRecord record : pending) {
    RefundQueryResult result = alipay.queryRefund(
        record.getOutTradeNo(),
        record.getOutRefundNo()
    );
    if (result.isSuccess()) {
        updateRefundSuccess(record);
    } else if (result.isFailed()) {
        updateRefundFailed(record);
    }
    // PROCESSING 就继续等，下次再查
}
```

**被动回调**：接收渠道推送，做幂等处理。

```java
@PostMapping("/refund/notify")
public String handleRefundNotify(AlipayRefundNotify notify) {
    RefundRecord record = refundDao.findByRefundNo(notify.getOutRefundNo());
    if (record.getStatus() != REFUNDING) {
        return "success";  // 已处理
    }
    verifySign(notify);
    updateRefundSuccess(record);
    return "success";
}
```

两条路同时走，哪条先到就先处理，互相兜底。

---

## 幂等更新：CAS 防并发

主动查询和被动回调可能同时到达，都尝试把状态从 `REFUNDING` 改成 `SUCCESS`。用 CAS 保证只有一次写入：

```java
void updateRefundSuccess(RefundRecord record) {
    int rows = refundDao.updateStatus(
        record.getId(), SUCCESS, REFUNDING  // WHERE status = REFUNDING
    );
    if (rows == 0) return;  // 已被其他请求处理

    // 更新订单状态、通知用户等后续逻辑
    orderService.onRefundSuccess(record.getOrderId());
}
```

这个 CAS 模式和支付回调去重是一样的：`WHERE status = 旧状态` 确保只有第一个请求能推进状态。

---

## 退款失败怎么处理

渠道侧退款失败（不是调用失败，是渠道确认无法退款）不常见，但要有处理路径：

1. 记录失败原因，更新订单为"退款失败"状态
2. 通知运营人工介入（发邮件/飞书告警）
3. 不要自动重试（重试可能产生重复退款单）

重复退款的危害比退款慢更大——钱多退了，追回来很麻烦。

---

退款失败有一个容易踩的坑：错误处理。不要无脑重试——渠道确认"无法退款"和"当前超时"是两种完全不同的情况，前者重试也没用，徒增重复退款的风险。两条路哪条先到都能处理，但都不能重复触发，这才是真正做完了退款。
