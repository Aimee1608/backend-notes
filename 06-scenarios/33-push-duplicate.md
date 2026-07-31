# 同一条消息推送了三次

用户反馈：刚才连续收到三条一模一样的推送通知。

日志里能查到这条消息，确实发送了三次——每次间隔大概 2-3 秒，内容完全一致。

---

## 根源：MQ 的 at-least-once 语义

消息队列默认保证"至少送达一次"（at-least-once），不保证"只送达一次"（exactly-once）。

消费者拉取消息 → 处理 → 发 ACK 给 MQ。如果在 ACK 之前：
- 消费者挂了
- 网络抖动 ACK 没送达
- 消费者处理超时，MQ 认为超时重投

MQ 会把消息重新投递给其他消费者（或同一消费者），于是同一条消息被消费了多次。

推送服务如果不做幂等，就会推送多次。

---

## 推送幂等：消息 ID 去重

每条推送消息在生成时分配一个唯一的 `msgId`。推送服务消费时，用 Redis 记录"这个 msgId 已处理过"：

```java
public void consumePushMessage(PushMessage msg) {
    String dedupKey = "push:sent:" + msg.getMsgId();

    // setIfAbsent: 只有第一次会返回 true
    Boolean isFirst = redis.setIfAbsent(dedupKey, "1", 24, TimeUnit.HOURS);
    if (!Boolean.TRUE.equals(isFirst)) {
        log.info("Duplicate push message {}, skip", msg.getMsgId());
        return;
    }

    // 真正发推送
    pushGateway.send(msg.getDeviceToken(), msg.getTitle(), msg.getBody());
}
```

`setIfAbsent` 是原子操作，并发情况下只有一个线程能成功写入，其余线程走去重逻辑。

TTL 设为 24 小时足够覆盖 MQ 的重投窗口——正常情况下 MQ 不会延迟 24 小时才重投。

---

## msgId 从哪来

msgId 必须在**生产端**就确定，不能在消费端生成——消费端每次消费生成一个新 ID，去重就失效了。

常见方案：
- 业务事件 ID（如订单 ID + 事件类型）拼接：`orderId:123456:PAID`
- 上游业务自行生成 UUID，写入 MQ 消息体
- MQ 消息头的 `messageId`（Kafka 没有内置，RocketMQ 有 `msgId`，但 RocketMQ 的 msgId 在 broker 重启后可能重置，业务层 ID 更可靠）

---

## 为什么三次而不是两次

这不是偶然的，说明消费端的 ACK 超时时间配置得偏短，或者推送网关响应慢导致消费超时被重投。

排查步骤：
1. 看 MQ 消费端日志：三次消费是同一个 consumer 实例还是不同实例？
2. 看推送网关耗时：第一次消费是否因为超时而没有 ACK？
3. 调整消费端 ACK 超时：把超时时间配置成推送网关 P99 耗时的 3-5 倍

幂等去重是根本解；优化超时配置减少不必要的重投是辅助。两件事都要做。

---

设备侧也可以做最后一道防线：App 在本地记录最近 N 条 msgId，收到重复的 msgId 直接静默丢弃，不展示给用户。但这是 App 的职责，后端不能依赖客户端来兜底。
