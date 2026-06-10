// Run: `node demo.js`
// 用三个对照场景,直观看出"能跑通"和"好接口"差在哪。
const {
  OrderStore,
  createOrderNoIdempotency,
  makeIdempotentCreator,
  makeRows,
  offsetPage,
  cursorPage,
  badLogin,
  goodLogin,
} = require('./lib');

function line(label, value) { console.log(`  ${label.padEnd(30)} ${value}`); }
function title(t) { console.log(`\n=== ${t} ===`); }

// 场景一:幂等 —— 同一个幂等键,把"创建订单"调两次
function idempotencyDemo() {
  title('场景一 · 幂等:同一个 Idempotency-Key,创建订单调用两次');

  // ① 不做幂等:模拟网络重试 / 用户连点两次,各建一单 —— 重复扣款
  {
    const store = new OrderStore();
    const payload = { userId: 7, amount: 100 };
    createOrderNoIdempotency(store, payload);
    createOrderNoIdempotency(store, payload); // 第二次又建了一单
    line('不做幂等,最终订单数', store.count() + '   ← 同一笔被建成两单(扣两次款)');
  }

  // ② 做幂等:带同一个 key,第二次命中去重表,直接回放第一次的结果
  {
    const store = new OrderStore();
    const createOrder = makeIdempotentCreator(store);
    const key = 'order-req-abc-123';      // 调用方为"这一次下单"生成的唯一键
    const payload = { userId: 7, amount: 100 };

    const r1 = createOrder(key, payload);
    const r2 = createOrder(key, payload);  // 重试:同一个 key 再来一次

    line('做幂等,第一次 orderId', r1.order.orderId + `  (replayed=${r1.replayed})`);
    line('做幂等,第二次 orderId', r2.order.orderId + `  (replayed=${r2.replayed})  ← 回放上次结果`);
    line('做幂等,最终订单数', store.count() + '   ← 只建了一单');
  }
}

// 场景二:分页 —— offset 深分页 vs 游标分页,比"扫描行数"
function paginationDemo() {
  title('场景二 · 分页:取第 1000 页(每页 10 条),offset vs 游标的扫描行数');

  const rows = makeRows(100000); // 10 万行数据
  const size = 10;
  const page = 1000;             // 翻到很深的一页

  // offset 分页:要先跳过 (page-1)*size 行,再读 size 行 —— 扫描行数随页数线性增长
  const off = offsetPage(rows, page, size);
  line('offset 分页,扫描行数', off.scanned + `   ← 跳过 ${(page - 1) * size} 行 + 读 ${size} 行`);
  line('offset 分页,本页首条 id', off.data[0].id);

  // 游标分页:用"上一页最后一条 id"直接定位,只读 size 行 —— 扫描行数恒定
  // 先拿到第 999 页最后一条的 id 当游标(模拟"上一页给的 nextCursor")
  const prevLastId = (page - 1) * size; // 第 999 页最后一条的 id = 9990
  const cur = cursorPage(rows, prevLastId, size);
  line('游标分页,扫描行数', cur.scanned + `      ← 只读 ${size} 行,与翻多深无关`);
  line('游标分页,本页首条 id', cur.data[0].id);
  line('游标分页,下一页游标', cur.nextCursor + '   ← 调用方拿它请求下一页');

  const ratio = Math.round(off.scanned / cur.scanned);
  line('扫描行数差距', `约 ${ratio} 倍   ← 越往后翻,offset 越吃亏`);
}

// 场景三:统一错误结构 —— 烂返回 vs 好返回
function errorShapeDemo() {
  title('场景三 · 错误处理:同样的登录失败,烂返回 vs 好返回');

  const cases = [
    ['缺参数(没传密码)', 'alice', ''],
    ['密码错误', 'alice', 'wrong-password'],
    ['登录成功', 'alice', 'correct-password'],
  ];

  console.log('\n  烂返回:全是 HTTP 200,body 只给一句模糊文案 ——');
  for (const [desc, u, p] of cases) {
    const res = badLogin(u, p);
    line(`  ${desc}`, `HTTP ${res.httpStatus}  ${JSON.stringify(res.body)}`);
  }
  console.log('  → 调用方看不出成败、定位不到问题,只能盲猜。');

  console.log('\n  好返回:状态码分清"谁的锅",body 统一 {code,message,details} ——');
  for (const [desc, u, p] of cases) {
    const res = goodLogin(u, p);
    line(`  ${desc}`, `HTTP ${res.httpStatus}  ${JSON.stringify(res.body)}`);
  }
  console.log('  → 4xx=调用方传错,401=认证失败,2xx=成功;code 可判定、details 可定位。');
}

function main() {
  idempotencyDemo();
  paginationDemo();
  errorShapeDemo();
  console.log('\n提示:把幂等 / 游标分页 / 统一错误结构的"好"版本去掉再跑,体会调用方的痛。\n');
}

main();
