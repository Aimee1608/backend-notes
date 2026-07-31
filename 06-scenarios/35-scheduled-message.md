# 定时消息任务触发了两次

用户反馈说收到两条一模一样的活动提醒，发送时间相差不到 1 秒。

看日志，这条定时任务的执行记录出现了两次，两次都显示"执行成功"。

不是 MQ 重投的问题，定时任务根本没走 MQ——是调度器直接触发的。

---

## 分布式调度器的多节点问题

单机调度器（比如 Spring `@Scheduled`）不存在这个问题，因为只有一个进程。

但服务部署了 3 个节点，三个节点同时跑 `@Scheduled`，同一时刻三个节点都会触发同一个任务——没有协调机制，谁都不知道别人也触发了。

这是分布式调度最基础的问题：**多节点竞争同一个任务**。

---

## 分布式锁抢任务

最简单的解法：每次触发时先抢分布式锁，抢到了才执行：

```java
@Scheduled(cron = "0 0 10 * * ?")
public void sendActivityReminder() {
    String lockKey = "scheduled:activity-reminder:" + LocalDate.now();
    boolean locked = redisLock.tryLock(lockKey, 30, TimeUnit.SECONDS);
    if (!locked) {
        log.info("Another node is handling this task, skip");
        return;
    }
    try {
        doSendActivityReminder();
    } finally {
        redisLock.unlock(lockKey);
    }
}
```

锁的 key 里带日期，每天一把新锁，不会因为昨天的锁没过期影响今天。

TTL 设成任务执行时间的 2 倍左右，防止执行节点宕机后锁永远不释放导致后续触发也无法执行。

---

## 更可靠的方案：专业分布式调度框架

分布式锁能解决重复触发，但还有其他问题：哪个节点执行了、执行多久了、失败了怎么重试、任务执行历史在哪里查？

专业的分布式调度框架（XXL-Job、ElasticJob、SchedulerX）从调度层面解决这些问题：

- 任务由调度中心统一下发给一个执行节点，不是所有节点同时触发
- 执行节点上报执行状态
- 失败自动重试，重试次数可配置
- 可视化任务监控和日志

如果系统里已经有这类框架，优先用它，不要自己在 Spring 里加分布式锁。

---

## 任务版本号：防止旧任务覆盖新状态

有时候问题不是两次触发，而是：任务 A 触发后执行很慢，同时任务 B（相同类型，新的一次触发）也开始执行。A 执行完更新数据时，B 可能已经把状态推进得更远了——A 的更新反而把状态回退了。

防御方式是乐观锁版本号：

```sql
UPDATE scheduled_task
SET status = 'DONE', version = version + 1
WHERE id = ? AND version = ?
```

如果版本号不符，说明中间有其他任务修改过，本次更新忽略。

---

exactly-once 的定时任务执行，核心原则：**调度层保证只触发一次（分布式锁或调度框架），执行层保证幂等（版本号或状态检查）**。两层都做，才能真正避免重复执行的影响。
