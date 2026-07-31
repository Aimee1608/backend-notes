# 集卡稀有卡设了 5% 概率，活动结束超发了几千张

稀有卡概率设了 5%，奖品准备了 500 份，活动预计跑一周。结果上线 2 小时，奖品没了，已集齐用户 12000 人。

5% 听起来很低——但如果有 50 万次抽卡请求，期望出 2.5 万张稀有卡。就算随机波动，也跑不掉几千张。

**概率控制的是频率，不控制总量。** 想控总量，得换个思路。

## 解法：提前生成固定数量的稀有卡，放进卡池

不用概率控制，改成**预生成卡池**：活动前把 500 张稀有卡写进 Redis List，用完就没了。不管抽多少次，稀有卡的数量上限就是 500。

---

## 用 Redis List 做卡池

抽卡逻辑按顺序判断：

1. 检查用户卡包 → 已有该卡：换发一张普通卡（去重）
2. 没有该卡 → 检查稀有卡池
   - 卡池为空：发普通卡
   - 卡池有卡 → 命中概率（5%）？
     - 没命中：发普通卡
     - 命中：`RPOP` 从卡池取一张 → 发稀有卡
3. 记录到用户卡包

卡池用 Redis List 存储，`RPOP` 是原子操作：

```python
# 活动前预生成：把 500 张稀有卡写入卡池
for i in range(500):
    redis.rpush("card_pool:rare", f"rare_card_{i}")

def draw_card(user_id: str) -> str:
    # 1. 查用户已有的卡
    user_cards = db.get_user_cards(user_id)

    # 2. 检查是否命中稀有卡概率
    hit_rare = random.random() < 0.05  # 5% 概率

    if hit_rare:
        # 3. 原子取卡，取不到就降级发普通卡
        rare_card = redis.rpop("card_pool:rare")
        if rare_card and rare_card not in user_cards:
            db.save_card(user_id, rare_card)
            return rare_card

    # 4. 发普通卡（用户没有的那张）
    normal_card = pick_normal_card(user_cards)
    db.save_card(user_id, normal_card)
    return normal_card
```

`RPOP` 的关键：Redis 单线程，并发下多个请求都来取卡，每个人拿到的都是不同的一张。卡池空了，`RPOP` 返回 `nil`，系统自动降级发普通卡。**稀有卡不会超发。**

---

## 用户已有的卡，不该再发

这个细节很容易漏。

用户已经有第3张卡了，再发一张第3张，用户体验很差（而且没用）。发卡前要检查用户卡包，发用户没有的那张。

但注意：稀有卡如果用户已有，不要因此把这张卡"放回"卡池，直接作废就好——放回会导致顺序问题，而且逻辑变复杂。

---

## 活动前要做的两件事

**1. 预生成卡池，写入 Redis**
活动开始前把稀有卡推进 Redis List，不能等活动开始时才初始化（同红包雨的道理，那时候流量最大）。

**2. 监控卡池剩余量**
```bash
redis-cli llen card_pool:rare  # 实时看稀有卡剩余数
```
剩余低于 10% 的时候运营侧可以提前准备提示用户"名额紧张"，也可以决定是否补充投放。

---

**两层控制，缺一不可**：概率控制频率、卡池控制总量——稀有卡必须提前放进 Redis List，`RPOP` 原子取，取完就是取完，不能靠概率估算。
