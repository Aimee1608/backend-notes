// A zero-dependency in-memory demo lib for classic caching problems & guards.
// 用内存模拟"慢数据库 + 带 TTL 的缓存",配套文章见同目录 README。
// 直接 `node demo.js` 运行,无需安装 Redis。

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 模拟一个"慢"的数据库:每次查询都有固定延迟,并统计回源次数。
// queryCount 就是我们要尽量压低的指标 —— 缓存的意义就是减少它。
class FakeDB {
  constructor(latencyMs = 50) {
    this.store = new Map();
    this.latencyMs = latencyMs;
    this.queryCount = 0; // 被回源(真正查 DB)的次数
  }
  seed(id, value) { this.store.set(id, value); }
  async query(id) {
    this.queryCount++;
    await sleep(this.latencyMs); // 模拟磁盘 / 网络开销
    return this.store.has(id) ? this.store.get(id) : null;
  }
  async write(id, value) {
    await sleep(this.latencyMs);
    this.store.set(id, value);
  }
  resetCount() { this.queryCount = 0; }
}

// 一个带 TTL(过期时间)的内存缓存。
// 传 { verbose: true } 后,每次缓存操作都会打印一行,方便看清"创建 / 命中 / 删除"的全过程。
class TTLCache {
  constructor(opts = {}) {
    this.store = new Map();          // key -> { value, expireAt }
    this.verbose = opts.verbose || false;
  }
  log(action, key, extra = '') {
    if (this.verbose) console.log(`    [cache] ${action.padEnd(8)} ${key}${extra ? '  ' + extra : ''}`);
  }
  get(key) {
    const item = this.store.get(key);
    if (!item) { this.log('MISS', key); return undefined; }   // 未命中
    if (Date.now() > item.expireAt) {                          // 命中但已过期 —— 当作未命中
      this.store.delete(key);
      this.log('EXPIRED', key, '(已过期,当未命中)');
      return undefined;
    }
    this.log('HIT', key);                                      // 命中
    return item; // 返回整个 item(value 可能是 null,表示缓存了"空值")
  }
  set(key, value, ttlMs) {
    this.store.set(key, { value, expireAt: Date.now() + ttlMs });
    this.log('SET', key, `ttl=${ttlMs}ms`);                    // 写入(创建 / 回填)
  }
  del(key) {
    this.store.delete(key);
    this.log('DEL', key);                                      // 删除(失效)
  }
}

// 缓存客户端:封装 Cache-Aside(旁路缓存)读写,按 opts 开启不同防护。
class CacheClient {
  // opts:
  //   ttl          缓存有效期(ms)
  //   cacheNull    是否缓存"空值"(防穿透);nullTtl 为空值的短有效期
  //   singleFlight 是否开启"单飞"(防击穿):同一 key 并发只放一个请求去查 DB
  //   jitter       TTL 是否加随机抖动(防雪崩):避免大批 key 同时过期
  constructor(cache, db, opts = {}) {
    this.cache = cache;
    this.db = db;
    this.opts = Object.assign(
      { ttl: 2000, cacheNull: false, nullTtl: 500, singleFlight: false, jitter: false, keyPrefix: 'item' },
      opts
    );
    this.inflight = new Map(); // 单飞用:key -> 正在进行的查询 Promise
  }

  key(id) { return `${this.opts.keyPrefix}:${id}`; }

  // 实际 TTL:开启 jitter 时,在基础 TTL 上叠加 0~50% 的随机时间,把过期点打散。
  effectiveTtl() {
    const { ttl, jitter } = this.opts;
    return jitter ? ttl + Math.floor(Math.random() * ttl * 0.5) : ttl;
  }

  // Cache-Aside 读:先查缓存,未命中再回源 DB,然后回填缓存。
  async read(id) {
    const k = this.key(id);

    const cached = this.cache.get(k);
    if (cached !== undefined) return cached.value; // 命中(也可能命中"空值")

    // 未命中 —— 单飞:同一 key 已有在途请求,就复用它的结果,不再打 DB。
    if (this.opts.singleFlight && this.inflight.has(k)) {
      return this.inflight.get(k);
    }

    const load = (async () => {
      const value = await this.db.query(id); // 回源
      if (value === null) {
        // 没查到:开了防穿透就缓存一个短命的空值,挡住后续相同的无效请求。
        if (this.opts.cacheNull) this.cache.set(k, null, this.opts.nullTtl);
      } else {
        this.cache.set(k, value, this.effectiveTtl());
      }
      return value;
    })();

    if (this.opts.singleFlight) {
      this.inflight.set(k, load);
      try { return await load; }
      finally { this.inflight.delete(k); } // 查完清掉在途标记
    }
    return load;
  }

  // Cache-Aside 写:先写 DB,再删缓存(不是改写缓存)。下次读自然回填最新值。
  async update(id, value) {
    await this.db.write(id, value);
    this.cache.del(this.key(id)); // 删除而非更新 —— 原因见文章"一致性"一节
  }
}

module.exports = { FakeDB, TTLCache, CacheClient, sleep };
