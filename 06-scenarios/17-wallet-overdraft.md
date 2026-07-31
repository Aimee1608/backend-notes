# 并发提现，余额扣成了负数——这个坑不只出现在钱包

账户余额 100 元，两个提现请求同时进来，每个要提 80 元。

理论上只应该有一个成功，另一个因余额不足被拒。结果两个都通过了，余额变成了 -60。

---

## 读-判-写三步不是原子的

最常见的错误实现：

```java
BigDecimal balance = walletDao.getBalance(userId);   // 读：100
if (balance.compareTo(amount) < 0) {                 // 判：100 >= 80，通过
    throw new InsufficientBalanceException();
}
walletDao.deduct(userId, amount);                    // 写：100 - 80 = 20
```

两个请求几乎同时执行，都在"写"之前完成了"读"和"判"，都拿到了 `balance = 100`，都判断通过，都执行了扣减。

最终：`100 - 80 - 80 = -60`。

---

## 方案一：数据库行锁（`SELECT FOR UPDATE`）

最简单直接，锁住读操作，让并发请求串行化：

```java
@Transactional
public void withdraw(Long userId, BigDecimal amount) {
    // 加 FOR UPDATE，锁住这一行
    BigDecimal balance = walletDao.getBalanceForUpdate(userId);
    if (balance.compareTo(amount) < 0) {
        throw new InsufficientBalanceException();
    }
    walletDao.deduct(userId, amount);
}
```

对应 SQL：

```sql
-- 在事务内
SELECT balance FROM wallet WHERE user_id = ? FOR UPDATE;
UPDATE wallet SET balance = balance - ? WHERE user_id = ?;
```

`FOR UPDATE` 保证两个并发请求中，第一个读到锁并扣款，第二个读操作阻塞等锁释放，等到锁释放后读到的是扣后余额，余额不足则拒绝。

适合场景：提现并发量不高，或提现本身有频率限制（大多数钱包产品每天提现次数有上限）。

---

## 方案二：乐观锁（`version` 字段）

不加锁，读的时候记录 version，写的时候用 version 做条件：

```java
Wallet wallet = walletDao.findById(userId);   // 返回含 version 的对象
if (wallet.getBalance().compareTo(amount) < 0) {
    throw new InsufficientBalanceException();
}

int rows = walletDao.deductWithVersion(userId, amount, wallet.getVersion());
if (rows == 0) {
    throw new ConcurrentModificationException("余额已变更，请重试");
}
```

SQL：

```sql
UPDATE wallet
SET balance = balance - ?, version = version + 1
WHERE user_id = ? AND version = ?
```

并发两个请求，第一个更新成功（`version` 从 1 变 2），第二个的 `WHERE version = 1` 匹配不到行，`affected rows = 0`，返回重试或失败。

乐观锁适合冲突概率低、可接受重试的场景；行锁适合需要严格串行、不想让用户看到重试错误的场景。

---

## 更简单的 SQL 写法：原子 CAS

不需要应用层 version，直接在 SQL 里做余额校验：

```sql
UPDATE wallet
SET balance = balance - ?
WHERE user_id = ? AND balance >= ?
```

`affected rows = 0` → 余额不足或被其他请求抢先。

这是最简洁的写法，利用数据库行锁的天然原子性——同一行 `UPDATE` 并发时数据库会串行化执行。

---

## 余额校验要放在哪一步

一个容易踩的坑：在服务层做了余额校验，但校验和扣款不在同一事务里，两步之间有时间差。

```java
// 错误：校验和扣款分开，中间有窗口
checkBalance(userId, amount);   // 事务1：检查
// ... 中间可能有其他操作 ...
deductBalance(userId, amount);  // 事务2：扣款
```

校验和扣款必须在同一事务里，用 `FOR UPDATE` 或者 `WHERE balance >= amount` 的 CAS，才能保证原子性。

---

## 三种方案怎么选

| 方案 | 适用场景 | 注意点 |
|------|---------|--------|
| `SELECT FOR UPDATE` | 并发低，需严格串行 | 锁持有期间其他请求排队等待 |
| 乐观锁（version） | 冲突率低，可重试 | 高并发冲突时重试风暴 |
| `WHERE balance >= amount` 原子 CAS | 大多数余额扣减场景 | `rows=0` 必须有对应的失败处理 |

钱包、账户这类场景通常用第三种——最简洁，且利用了数据库行锁的天然原子性，不需要额外引入 version 字段。乐观锁留给冲突率真的很低的业务，FOR UPDATE 留给有强顺序要求的操作（比如同一个账户的转账流水要串行记录）。
