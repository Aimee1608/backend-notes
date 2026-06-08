// Run: `node demo.js`
// 用"扫描行数 + 耗时"直观看出每种慢查询的根因,以及索引 / 预聚合 / 游标的提速效果。
const { buildOrders, OrdersTable, timeit } = require('./lib');

function line(label, value) { console.log(`  ${label.padEnd(28)} ${value}`); }
function title(t) { console.log(`\n=== ${t} ===`); }
const ms = (x) => x.toFixed(3) + ' ms';

// 造一张几万行的订单明细表。N 调大一点,差距更明显。
const N = 50000;
const USER_COUNT = 1000;
const DAY_COUNT = 30;
const rows = buildOrders(N, USER_COUNT, DAY_COUNT);

function main() {
  console.log(`订单明细表:${N} 行,${USER_COUNT} 个用户,${DAY_COUNT} 天\n`);

  // 场景一:按 userId 查订单 —— 全表扫 O(n) vs 走索引 O(命中行数)
  title('场景一 · 点查:按 userId 查订单(全表扫 vs 索引)');
  {
    const t = new OrdersTable(rows);
    const targetUser = 7;

    t.resetScan();
    const a = timeit(() => t.findByUserFullScan(targetUser));
    line('全表扫:扫描行数', t.scanned + `   ← 摸遍全表 ${N} 行`);
    line('全表扫:耗时', ms(a.ms));

    // 建索引是一次性成本,之后每次点查都受益。
    const build = timeit(() => t.buildUserIndex());
    line('(一次性)建索引耗时', ms(build.ms));

    t.resetScan();
    const b = timeit(() => t.findByUserIndexed(targetUser));
    line('走索引:扫描行数', t.scanned + `   ← 只摸命中的 ${b.result.length} 行`);
    line('走索引:耗时', ms(b.ms));
    line('扫描行数下降', `${N} → ${t.scanned}`);
  }

  // 场景二:按天聚合总额 —— 实时 group by O(n) vs 查预聚合好的汇总表
  title('场景二 · 聚合:某天订单总额(实时聚合 vs 预聚合汇总表)');
  {
    const t = new OrdersTable(rows);
    const targetDay = '2026-06-15';

    t.resetScan();
    const a = timeit(() => t.dailyTotalRealtime());
    line('实时聚合:扫描行数', t.scanned + `   ← 每次刷新都重扫全表 ${N} 行`);
    line('实时聚合:耗时', ms(a.ms));

    // 预聚合也是一次性成本:定时任务跑一次,把每天的汇总算好存进汇总表。
    const build = timeit(() => t.buildDailyTotal());
    line('(一次性)预聚合耗时', ms(build.ms));

    t.resetScan();
    const b = timeit(() => t.dailyTotalPrecomputed(targetDay));
    line('查汇总表:扫描行数', t.scanned + '       ← 只摸汇总表 1 行');
    line('查汇总表:耗时', ms(b.ms));
    line(`${targetDay} 总额`, b.result);
    line('扫描行数下降', `${N} → ${t.scanned}`);
  }

  // 场景三:深分页 —— offset 跳过 N 行 vs 游标(书签法)按上次最大 id 续上
  title('场景三 · 深分页:取第 40000 条往后 20 条(offset vs 游标)');
  {
    const t = new OrdersTable(rows);
    const offset = 40000, size = 20;

    t.resetScan();
    const a = timeit(() => t.pageByOffset(offset, size));
    line('offset 分页:扫描行数', t.scanned + `   ← 为跳过前 ${offset} 行,仍要逐行读出再丢`);
    line('offset 分页:耗时', ms(a.ms));

    // 游标分页:拿上一页最后一条的 id 当书签,直接续上。
    const lastId = a.result.length ? t.rows[offset - 1].id : 0;
    t.resetScan();
    const b = timeit(() => t.pageByCursor(lastId, size));
    line('游标分页:扫描行数', t.scanned + `        ← 沿索引跳到书签,只摸要返回的 ${b.result.length} 行`);
    line('游标分页:耗时', ms(b.ms));
    line('扫描行数下降', `${offset + size} → ${t.scanned}`);
  }

  console.log('\n一句话:慢查询的根因常是"扫的行太多"。索引把"全表扫"变成"按 key 直达",');
  console.log('预聚合把"每次重算"变成"查一行现成的",游标把"跳过 N 行"变成"从书签续上"。\n');
}

main();
