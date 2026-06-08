// A zero-dependency in-memory demo lib for slow-query problems & fixes.
// 用内存数组模拟一张"订单明细表",对比"全表扫 / 实时聚合 / 深分页 offset"
// 这些慢查询的根因,以及"索引 / 预聚合 / 游标"各自的提速效果。
// 直接 `node demo.js` 运行,无需安装 MySQL。

// 高精度计时:返回毫秒(浮点),Node 原生,够这个 demo 用。
function timeit(fn) {
  const start = process.hrtime.bigint();
  const result = fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { result, ms };
}

// 造一张"订单"明细表:N 行,字段 id / userId / amount / day。
// 用普通数组存,模拟数据库里"一行行堆着的明细数据"。
// rows 按 id 递增插入(等价于自增主键),天然有序 —— 这是后面"游标分页"能成立的前提。
function buildOrders(n, userCount, dayCount) {
  const rows = [];
  for (let id = 1; id <= n; id++) {
    rows.push({
      id,
      userId: (id % userCount) + 1,                 // 把订单大致均匀摊给若干用户
      amount: Math.floor(Math.random() * 1000) + 1, // 1~1000 的金额
      day: `2026-06-${String((id % dayCount) + 1).padStart(2, '0')}`, // 落在若干天里
    });
  }
  return rows;
}

// 一张"明细表",带一个可统计的"扫描行数"指标。
// scanned 就是这次查询真正"摸过"的行数 —— 慢查询的本质,往往就是它太大。
class OrdersTable {
  constructor(rows) {
    this.rows = rows;
    this.scanned = 0;
    // 索引:userId -> [该用户的订单...]。建一次,后续查询直接用,不再全表扫。
    // 对应数据库里的二级索引(B+ 树);这里用 Map 模拟"按 key 直接定位"的 O(1) 效果。
    this.userIndex = null;
    // 预聚合:day -> 当天总额。也是建一次,看板查它而不是每次重算。
    this.dailyTotal = null;
  }

  resetScan() { this.scanned = 0; }

  // ---- 场景一:按 userId 查订单 ----

  // 全表扫:遍历每一行,挨个比对 userId。扫描行数 = 全表行数,O(n)。
  findByUserFullScan(userId) {
    const out = [];
    for (const row of this.rows) {
      this.scanned++;                       // 每摸一行就 +1
      if (row.userId === userId) out.push(row);
    }
    return out;
  }

  // 建索引:把"userId -> 订单列表"提前归好类。建索引本身要扫一遍全表(一次性成本)。
  buildUserIndex() {
    const idx = new Map();
    for (const row of this.rows) {
      if (!idx.has(row.userId)) idx.set(row.userId, []);
      idx.get(row.userId).push(row);
    }
    this.userIndex = idx;
  }

  // 走索引:直接按 userId 拿到那一摞订单,扫描行数 = 命中的行数,与全表无关。
  findByUserIndexed(userId) {
    const hit = this.userIndex.get(userId) || [];
    this.scanned += hit.length;             // 只摸命中的那些行
    return hit;
  }

  // ---- 场景二:按天聚合总额 ----

  // 实时聚合:每次都遍历全表,边扫边累加,O(n)。看板每刷新一次就重算一次。
  dailyTotalRealtime() {
    const totals = new Map();
    for (const row of this.rows) {
      this.scanned++;
      totals.set(row.day, (totals.get(row.day) || 0) + row.amount);
    }
    return totals;
  }

  // 预聚合:提前把每天的总额算好存起来(汇总表)。也是扫一遍全表的一次性成本。
  buildDailyTotal() {
    const totals = new Map();
    for (const row of this.rows) {
      totals.set(row.day, (totals.get(row.day) || 0) + row.amount);
    }
    this.dailyTotal = totals;
  }

  // 查汇总表:直接按 day 取已经算好的数,扫描行数 = 1(只摸汇总表那一行)。
  dailyTotalPrecomputed(day) {
    this.scanned += 1;
    return this.dailyTotal.get(day);
  }

  // ---- 场景三:深分页 ----

  // offset 分页:LIMIT offset, size 的模拟。数据库为了"跳过前 offset 行",
  // 仍要从头把这 offset 行都读出来再丢掉 —— 扫描行数 = offset + size。
  pageByOffset(offset, size) {
    const out = [];
    let i = 0;
    for (; i < this.rows.length && out.length < size; i++) {
      this.scanned++;                       // 跳过的行也算"摸过"
      if (i >= offset) out.push(this.rows[i]);
    }
    return out;
  }

  // 游标(书签)分页:记住上一页最后一条的 id,下一页直接从它之后开始。
  // 因为 rows 按 id 有序(等价于走主键索引),可以二分定位起点,不必从头扫。
  pageByCursor(lastId, size) {
    // 二分找到第一条 id > lastId 的位置 —— 模拟"沿索引直接跳到书签处"。
    let lo = 0, hi = this.rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.rows[mid].id <= lastId) lo = mid + 1;
      else hi = mid;
    }
    const out = [];
    for (let i = lo; i < this.rows.length && out.length < size; i++) {
      this.scanned++;                       // 只摸真正要返回的那些行
      out.push(this.rows[i]);
    }
    return out;
  }
}

module.exports = { buildOrders, OrdersTable, timeit };
