// Run: `node demo.js`
// 用"回源次数"直观看出每个缓存问题和它的防护效果。
const { FakeDB, TTLCache, CacheClient } = require('./cache-lib');

function line(label, value) { console.log(`  ${label.padEnd(26)} ${value}`); }
function title(t) { console.log(`\n=== ${t} ===`); }

// 场景零:把"创建 / 命中 / 删除"的全过程打印出来,看清缓存的一生。
async function lifecycle() {
  title('场景零 · 缓存的一生:创建 → 命中 → 改价失效 → 重建');
  const db = new FakeDB();
  db.seed(123, { id: 123, title: '保温杯', price: 99 });
  const cache = new TTLCache({ verbose: true });          // 打开日志,看清每一步缓存操作
  const client = new CacheClient(cache, db, { ttl: 3000, keyPrefix: 'product' });

  console.log('\n  ① 第一次读(缓存还没有)→ 未命中,回源 DB,再写入缓存');
  console.log('  返回:', JSON.stringify(await client.read(123)));

  console.log('\n  ② 第二次读 → 直接命中缓存,不碰 DB');
  console.log('  返回:', JSON.stringify(await client.read(123)));

  console.log('\n  ③ 商家改价(写 DB + 删缓存)');
  await client.update(123, { id: 123, title: '保温杯', price: 79 });

  console.log('\n  ④ 改价后再读 → 缓存已删 = 未命中,回源拿到新价,再写入');
  console.log('  返回:', JSON.stringify(await client.read(123)));

  console.log(`\n  全程 DB 回源次数:${db.queryCount}  ← 只有第 ① ④ 次未命中才查了库`);
}

async function main() {
  await lifecycle();

  // 场景一:缓存到底省了多少?
  title('场景一 · 缓存的价值:连读同一条数据 10 次');
  {
    const db = new FakeDB(); db.seed(1, { id: 1, name: 'Alice' });
    db.resetCount();
    for (let i = 0; i < 10; i++) await db.query(1);
    line('不用缓存,回源次数', db.queryCount);

    const db2 = new FakeDB(); db2.seed(1, { id: 1, name: 'Alice' });
    const client = new CacheClient(new TTLCache(), db2, { ttl: 5000 });
    for (let i = 0; i < 10; i++) await client.read(1);
    line('用缓存,回源次数', db2.queryCount + '   ← 另外 9 次走了缓存');
  }

  // 场景二:缓存穿透 —— 疯狂查一个不存在的 id
  title('场景二 · 缓存穿透:查一个不存在的 id 10 次');
  {
    const db = new FakeDB(); // 不 seed,id=999 永远查不到
    const noGuard = new CacheClient(new TTLCache(), db, { cacheNull: false });
    for (let i = 0; i < 10; i++) await noGuard.read(999);
    line('不防护,回源次数', db.queryCount + '   ← 每次都打到 DB');

    const db2 = new FakeDB();
    const guard = new CacheClient(new TTLCache(), db2, { cacheNull: true, nullTtl: 5000 });
    for (let i = 0; i < 10; i++) await guard.read(999);
    line('缓存空值后,回源次数', db2.queryCount + '   ← 第一次之后命中"空值"');
  }

  // 场景三:缓存击穿 —— 热点 key 失效瞬间,100 个并发同时到达
  title('场景三 · 缓存击穿:热点 key 过期瞬间,100 个并发请求');
  {
    const db = new FakeDB(); db.seed(1, { id: 1, name: 'Hot' });
    const noGuard = new CacheClient(new TTLCache(), db, { singleFlight: false });
    await Promise.all(Array.from({ length: 100 }, () => noGuard.read(1)));
    line('不防护,回源次数', db.queryCount + '   ← 100 个全打到 DB');

    const db2 = new FakeDB(); db2.seed(1, { id: 1, name: 'Hot' });
    const guard = new CacheClient(new TTLCache(), db2, { singleFlight: true });
    await Promise.all(Array.from({ length: 100 }, () => guard.read(1)));
    line('单飞(互斥)后,回源次数', db2.queryCount + '   ← 只放 1 个去查,其余等结果');
  }

  // 场景四:缓存雪崩 —— 大批 key 设了相同 TTL,会在同一时刻集体过期
  title('场景四 · 缓存雪崩:1000 个 key 的过期时刻分布');
  {
    const N = 1000, baseTtl = 2000;
    const fixed = new TTLCache();
    const jittered = new TTLCache();
    for (let i = 0; i < N; i++) {
      fixed.set(`user:${i}`, { id: i }, baseTtl);                         // 固定 TTL:全部 2000ms 后过期
      const jit = baseTtl + Math.floor(Math.random() * baseTtl * 0.5);   // 抖动 TTL:2000~3000ms
      jittered.set(`user:${i}`, { id: i }, jit);
    }
    const spread = (cache) => {
      const times = [...cache.store.values()].map((x) => x.expireAt);
      return Math.max(...times) - Math.min(...times); // 过期时刻的跨度(ms)
    };
    line('固定 TTL,过期跨度', spread(fixed) + ' ms   ← 几乎同时过期 = 雪崩');
    line('TTL 加抖动,过期跨度', spread(jittered) + ' ms ← 摊开到一段时间,不再扎堆');
  }

  // 场景五:缓存一致性 —— 更新数据后,缓存怎么办
  title('场景五 · 一致性:更新 DB 后"删缓存",下次读自动拿到新值');
  {
    const db = new FakeDB(); db.seed(1, { id: 1, name: '旧名字' });
    const client = new CacheClient(new TTLCache(), db, { ttl: 5000 });
    line('第一次读(回填缓存)', JSON.stringify(await client.read(1)));
    await client.update(1, { id: 1, name: '新名字' }); // 写 DB + 删缓存
    line('更新后再读(缓存已删)', JSON.stringify(await client.read(1)) + '   ← 重查 DB,拿到新值');
  }

  console.log('\n提示:把对应的防护开关关掉再跑,对比回源次数,体会每个防护的作用。\n');
}

main();
