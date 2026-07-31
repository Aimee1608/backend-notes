# 活动结束了，用户还在收短信

活动 8 点准时结束，但到了 8:05，用户还在陆续收到活动相关的短信通知。

运营觉得奇怪：代码里已经判断了"活动已结束不发短信"，为什么还在发？

原因不在判断逻辑，在任务队列里。

---

## 任务已入队，判断在消费前就做完了

典型的流程是这样：

活动期间，系统会把"要给 xxx 用户发短信"的任务批量写入消息队列（MQ）或任务表。活动在 8:00 结束，但队列里已经积压了 10 万条任务，消费者在消费时判断活动是否有效——问题是，入队时活动还有效，判断写在了入队那一步，而不是消费那一步。

或者消费端有判断，但判断逻辑是"任务创建时间 < 活动结束时间就发送"，而不是"现在发送时，活动还在进行中"。

修正方向很简单：**在真正执行发送前，重新检查活动状态**。

```java
public void processSmsTask(SmsTask task) {
    // 消费时再查一次活动状态，不依赖入队时的判断
    Activity activity = activityService.getById(task.getActivityId());
    if (activity == null || !activity.isActive()) {
        log.info("Activity {} is no longer active, skip sms for user {}", 
                 task.getActivityId(), task.getUserId());
        return;
    }
    smsGateway.send(task.getPhone(), task.getContent());
}
```

---

## 任务取消：从状态机角度看

如果队列里积压了几十万条任务，等消费端逐一判断效率太低，更好的方式是主动取消。

任务应该有状态：`PENDING → RUNNING → DONE / CANCELLED`

活动结束时，触发一个取消动作：

```sql
UPDATE sms_task
SET status = 'CANCELLED', updated_at = NOW()
WHERE activity_id = ?
  AND status = 'PENDING'
```

消费端消费前先检查状态：

```java
SmsTask task = smsTaskDao.selectForUpdate(taskId);
if (task.getStatus() != TaskStatus.PENDING) {
    return; // 已取消或已完成，跳过
}
task.setStatus(TaskStatus.RUNNING);
smsTaskDao.update(task);
// ... 发短信
```

这里用 `SELECT FOR UPDATE` 锁住那一行，防止取消操作和消费操作并发冲突。

---

## 取消传播的边界

任务取消不总是"活动一结束就全取消"。有时逻辑更细：

- 定向活动：只取消还没到达用户的任务，已发出的不管
- 优先级短信（如验证码）：不受活动状态影响，不取消
- 个性化触达：用户已完成触达目标（如已购买），这条短信任务取消

每种情况都需要在 `sms_task` 里带足够的上下文（活动 ID、任务类型、触发原因），取消时才能按业务规则筛选，而不是把所有 PENDING 任务一刀切取消。

---

## 对账与补偿

取消完成后，要统计本次活动实际发送量 vs 计划发送量：

- 差值 = 积压未发 + 消费时判断跳过的
- 如果发送量远低于预期，要确认是真的取消了，还是消费者挂了、任务卡住了

任务表留存状态流转日志，是事后排查的基础。没有任务状态、只有"发送成功/失败"的日志，出问题了很难还原全貌。
