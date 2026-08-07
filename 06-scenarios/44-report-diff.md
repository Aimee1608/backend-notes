# 报表昨天跑的数，今天重跑对不上——接到这个需求先把幂等搞清楚

运营说：上周的日活数据我重新核对了一遍，和之前看到的不一样。

开发排查后发现：数据确实变了，因为有用户昨天补录了上周的行为数据。报表任务昨天跑的时候，这批数据还不在，今天重跑就多了。

这不是 bug，是设计没想清楚：**报表要不要支持重跑？重跑结果要和原来一样，还是允许更新？**

---

## 幂等计算的前提：数据快照

如果要求"重跑结果和第一次一样"，那就需要在任务第一次跑之前，**给数据打快照**——基于快照计算，而不是基于当前实时数据。

```java
public void runDailyReport(LocalDate date) {
    // 先检查：今天的快照是否已存在
    if (snapshotDao.exists(date)) {
        log.info("Snapshot exists for {}, skip snapshot creation", date);
    } else {
        // 第一次跑：把当天的原始数据快照到报表库
        snapshotService.createSnapshot(date);
    }
    
    // 基于快照计算，无论重跑多少次结果都一样
    List<RawRecord> records = snapshotDao.queryByDate(date);
    ReportResult result = calculate(records);
    reportDao.upsert(date, result);
}
```

快照一旦创建就不再修改，后续补录的数据进不了这份快照，重跑结果天然幂等。

---

## 增量计算的水位线问题

另一类报表是增量的：每次只处理"上次处理到哪里"之后的新数据，用水位线（watermark）或游标记录进度：

```java
public void processIncremental() {
    long lastId = watermarkDao.getLastProcessedId("order_report");
    List<Order> batch = orderDao.findAfter(lastId, 1000);
    
    if (batch.isEmpty()) return;
    
    // 处理这批数据
    process(batch);
    
    // 更新水位线
    watermarkDao.update("order_report", batch.get(batch.size() - 1).getId());
}
```

增量计算的陷阱：**水位线是按 ID（自增）还是按时间？**

按时间水位线容易出问题：`WHERE created_at > lastWatermark` 会漏掉迟到数据（网络延迟、批量补录、时钟不一致导致的数据乱序）。

按 ID 水位线相对可靠（自增 ID 单调递增），但补录历史数据时 ID 在水位线之前，一样会漏。

---

## 增量 vs 全量

| | 增量 | 全量 |
|--|------|------|
| 计算量 | 小，只处理新数据 | 大，每次重算所有数据 |
| 迟到数据 | 处理复杂，需补偿机制 | 自然覆盖 |
| 重跑 | 需要回退水位线 | 直接重跑 |
| 适合场景 | 数据量大、实时性高 | 数据量可接受、准确性优先 |

"昨天的数和今天重跑对不上"，通常是用了增量计算但没有处理迟到数据。解法有两种：

1. **全量重算**：接受计算代价，每次跑T日报表就重算T日全部数据
2. **迟到数据补偿**：增量计算 + 单独的补偿逻辑——迟到数据入库后，触发对应日期的报表重跑

---

## 时区和"昨天"的边界

还有一类对不上是时区导致的：服务器存的是 UTC，报表按北京时间的"昨天"切割，边界处的数据因为时区换算错误被切到了错的天。

报表时间边界要明确定义并写在代码注释里：

```java
// 以北京时间 00:00:00 为日边界，转成 UTC 后是前一天 16:00:00
LocalDate reportDate = LocalDate.now(ZoneId.of("Asia/Shanghai")).minusDays(1);
ZonedDateTime start = reportDate.atStartOfDay(ZoneId.of("Asia/Shanghai")).toInstant();
ZonedDateTime end = reportDate.plusDays(1).atStartOfDay(ZoneId.of("Asia/Shanghai")).toInstant();
```

时区错误是低级但高频的坑，尤其在有海外用户或多机房的系统里。
