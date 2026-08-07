# UV 统计的误差问题，不是 bug，是选型问题

产品问：为什么今天的 UV 和数仓算出来的差了 5%？

这不一定是计算错了，而是 UV 本来就分两种做法，精度不同。

---

## PV 和 UV 的区别

PV（Page View）：页面访问次数，同一用户多次访问都算，累加即可。

UV（Unique Visitor）：独立访客数，同一用户多次访问只算一次。PV 可以直接加，UV 不行——UV 的本质是去重计数。

去重计数的两条路：精确计数和近似计数。

---

## 精确计数：`COUNT(DISTINCT user_id)`

存每次访问记录，查询时用 `COUNT(DISTINCT)`。

```sql
SELECT COUNT(DISTINCT user_id) FROM page_view
WHERE page = 'home' AND date = '2024-01-01'
```

数据量小时没问题。日访问量百万级、统计周期跨几个月，这条 SQL 会扫描几亿行，可能跑几十秒。

用 Redis Set 存今天访问过的用户 ID：

```java
redis.sadd("uv:home:2024-01-01", String.valueOf(userId));
long uv = redis.scard("uv:home:2024-01-01");
```

1000 万用户，Set 占 100 MB 内存，还能接受——但如果是全站统计、按页面打散，key 数量很多，内存很快撑不住。

---

## 近似计数：HyperLogLog

HyperLogLog 是 Redis 内置的近似基数统计算法，误差率约 0.81%，但内存固定只占 **12 KB**——不管统计多少用户，都是这么大。

```java
// 用户访问时
redis.pfadd("hll:uv:home:2024-01-01", String.valueOf(userId));

// 查询 UV
long uv = redis.pfcount("hll:uv:home:2024-01-01");

// 合并多天的 UV（去重合并）
redis.pfmerge("hll:uv:home:week", 
    "hll:uv:home:2024-01-01", 
    "hll:uv:home:2024-01-02", ...);
```

`PFMERGE` 可以把多个 HyperLogLog 合并成一个，合并后查 `PFCOUNT` 就是多天去重后的 UV——这是 Set 做不到的（合并两个 Set 的内存是两个 Set 之和）。

---

## 布隆过滤器：判断"有没有来过"

另一个场景：判断某个用户今天是不是首次访问，用来做"今日新增用户"统计。

用 Redis Set 判断：`SISMEMBER`，精确，但内存线性增长。

用 Bloom Filter：

```java
// 访问时：已经存在 → 今天来过，不算新增
//         不存在 → 第一次，算新增，然后 add 进去
if (!bloomFilter.mightContain(userId)) {
    bloomFilter.put(userId);
    newUserCount.incrementAndGet();
}
```

布隆过滤器的特性：**不存在一定不存在，存在可能误判**（一定存在的会说可能存在）。用于"首次访问"判断，误判意味着少算了几个新增用户，可以接受；如果误判代价很高（比如重复给用户发优惠券），就不能用。

---

## 选哪个

| 场景 | 推荐方案 |
|------|---------|
| 日 UV，用户量 < 100 万 | Redis Set，精确 |
| 日 UV，用户量 > 100 万 | HyperLogLog，近似 |
| 跨天/多页面聚合 UV | HyperLogLog（PFMERGE 去重合并） |
| 判断今日是否首次访问 | Bloom Filter |
| 需要精确数字（法务/财务） | 数仓离线计算（COUNT DISTINCT） |

精确计数和近似计数不是好坏之分，是速度和内存的取舍。产品需要实时看数但允许小误差，用 HyperLogLog；月底出财务报表必须精确，走数仓离线跑。
