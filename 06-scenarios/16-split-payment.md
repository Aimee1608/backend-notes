# 分账——多商户结算，一个失败了，已经出去的钱怎么办

你以为分账很简单：平台收了 1000 元，商户 A 分 600，商户 B 分 300，平台留 100 手续费，各自转账就行。

但第三家商户的账户被冻结，分账接口调用失败了——A 的 600 已经出去了，B 的 300 也出去了，现在怎么办？

---

## 分账不是原子操作

向多个商户分账，本质上是多个独立的转账操作。支付宝/微信的分账 API 是按商户逐一调用的，没有"原子分账"这种东西——要么全出，要么全不出，做不到。

所以这个问题不能靠外部 API 解决，只能靠平台自己设计补偿逻辑。

---

## SAGA 模式：给每步操作准备"撤销动作"

SAGA 是处理分布式事务的经典模式：把一个长事务拆成多个步骤，每一步成功后才执行下一步；某一步失败，按反向顺序逐一调用之前步骤的"撤销操作"（补偿操作）。

分账场景的 SAGA：

```
T1: 向商户A分账 600 元    ←→   C1: 申请退回商户A的 600 元
T2: 向商户B分账 300 元    ←→   C2: 申请退回商户B的 300 元
T3: 向商户C分账 50 元     ×    失败
```

T3 失败 → 执行 C2（退商户B 300）→ 执行 C1（退商户A 600）→ 整体回滚。

---

## 实现关键：记录每一步的状态

SAGA 要求每个步骤可重试、可回溯，所以必须把执行过程持久化：

```sql
CREATE TABLE split_record (
    id          BIGINT PRIMARY KEY,
    order_id    BIGINT,
    merchant_id BIGINT,
    amount      DECIMAL(10,2),
    status      ENUM('PENDING','SUCCESS','FAILED','COMPENSATING','COMPENSATED'),
    step_no     INT,       -- 步骤序号，回滚时用
    created_at  DATETIME,
    updated_at  DATETIME
);
```

执行流程：

```java
List<SplitRule> rules = getSplitRules(orderId);
for (int i = 0; i < rules.size(); i++) {
    SplitRule rule = rules.get(i);
    try {
        splitDao.insert(orderId, rule.getMerchantId(), rule.getAmount(), i);
        alipay.splitOrder(outTradeNo, rule.getMerchantId(), rule.getAmount());
        splitDao.updateStatus(orderId, rule.getMerchantId(), SUCCESS);
    } catch (Exception e) {
        splitDao.updateStatus(orderId, rule.getMerchantId(), FAILED);
        // 触发补偿：回滚 0..i-1 已成功的步骤
        compensate(orderId, i - 1, rules);
        throw new SplitException("分账失败，已触发回滚");
    }
}
```

---

## 补偿本身也可能失败

这是 SAGA 最棘手的地方：C1（退商户A）也可能因为网络超时而失败。

处理办法：

1. **补偿操作必须幂等**：同一笔退款可以安全重试，不会重复退
2. **记录补偿状态**：每个补偿步骤也写数据库，失败了有记录
3. **定时重试兜底**：扫描 `COMPENSATING` 状态超时的记录，自动重试
4. **最终人工处理**：重试若干次还失败，进人工处理队列，发告警

```java
// 定时任务：补偿失败重试
@Scheduled(fixedDelay = 300_000)
public void retryCompensation() {
    List<SplitRecord> stuckRecords = splitDao.findStuckCompensating(30);
    for (SplitRecord record : stuckRecords) {
        try {
            alipay.refundSplit(record.getMerchantId(), record.getAmount());
            splitDao.updateStatus(record.getId(), COMPENSATED);
        } catch (Exception e) {
            log.error("补偿重试失败: {}", record.getId(), e);
        }
    }
}
```

---

## 另一种思路：不立刻分，而是延迟分账

如果业务允许，分账可以不在支付完成后立刻执行，而是：

1. 支付成功后，钱暂存在平台账户
2. D+1 或 D+7 统一批量结算（类似淘宝的货款结算机制）
3. 批量结算期间，订单已经履约（发货/服务完成），可以确认金额

延迟分账的好处是：分账时机延后，中间有时间做退款/纠纷处理，不用担心分出去的钱要追回来。代价是商户不能立刻拿到款，现金流压力大。

---

延迟分账看起来绕，但如果业务能接受 D+1 结算，它其实省去了很多补偿复杂度——分账的时候退款纠纷已经处理完，少了追钱的麻烦。实时分账更符合商户预期，但补偿逻辑必须真正做完，不能停在"重试几次"就收手。
