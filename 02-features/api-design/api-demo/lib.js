// A zero-dependency in-memory demo lib for "what a good API looks like".
// 不起真实 server,用纯函数 + 内存模拟"接口处理",配套文章见同目录 README。
// 直接 `node demo.js` 运行,跑完即退出,无需任何依赖。

// ---------------------------------------------------------------------------
// 场景一:幂等(Idempotency)—— 同一个幂等键调用两次,只应产生一个订单
// ---------------------------------------------------------------------------

// 模拟"订单"数据库:每次创建都给一个自增 id,统计一共创建了几单。
class OrderStore {
  constructor() {
    this.orders = [];      // 已创建的订单
    this.seq = 0;          // 自增 id
  }
  create(payload) {
    this.seq += 1;
    const order = { orderId: this.seq, ...payload, status: 'CREATED' };
    this.orders.push(order);
    return order;
  }
  count() { return this.orders.length; }
}

// 不带幂等保护的"创建订单":来一次请求就建一单。
// 网络重试 / 用户重复点击时,会重复扣款、重复建单 —— 这正是要避免的。
function createOrderNoIdempotency(store, payload) {
  return store.create(payload);
}

// 带幂等保护的"创建订单":
// 用调用方传来的 Idempotency-Key 在服务端去重 ——
// 第一次正常创建并记下"键 -> 结果";第二次同键直接返回上次的结果,不再建单。
function makeIdempotentCreator(store) {
  const seen = new Map(); // idempotencyKey -> 第一次的结果(服务端去重表)
  return function createOrder(idempotencyKey, payload) {
    if (seen.has(idempotencyKey)) {
      return { order: seen.get(idempotencyKey), replayed: true }; // 命中去重表,回放旧结果
    }
    const order = store.create(payload);
    seen.set(idempotencyKey, order);
    return { order, replayed: false };
  };
}

// ---------------------------------------------------------------------------
// 场景二:分页(Pagination)—— offset 深分页 vs 游标分页,比"扫描行数"
// ---------------------------------------------------------------------------

// 造一批有序数据(按 id 递增),模拟一张表。
function makeRows(total) {
  const rows = [];
  for (let i = 1; i <= total; i++) rows.push({ id: i, name: `item-${i}` });
  return rows;
}

// offset 分页:`page` / `size`。
// 数据库要先"数着跳过"前 offset 行,再取 size 行 —— 翻得越深、扫描的行越多,越慢。
// scanned 就是为了取到这一页,引擎实际要走过的行数。
function offsetPage(rows, page, size) {
  const offset = (page - 1) * size;
  const scanned = offset + size;                 // 跳过 offset 行 + 读 size 行
  const data = rows.slice(offset, offset + size);
  return { data, scanned };
}

// 游标分页:基于"上一页最后一条的 id"继续往后取。
// 因为有序,引擎可以直接定位到游标之后,只读 size 行 —— 扫描行数与翻多深无关。
function cursorPage(rows, cursorId, size) {
  // cursorId 为 null 表示第一页;否则从 id > cursorId 处开始。
  const startIndex = cursorId == null ? 0 : rows.findIndex((r) => r.id === cursorId) + 1;
  const data = rows.slice(startIndex, startIndex + size);
  const scanned = data.length;                   // 直接定位,只读取这一页
  const nextCursor = data.length ? data[data.length - 1].id : null; // 下一页的游标
  return { data, scanned, nextCursor };
}

// ---------------------------------------------------------------------------
// 场景三:统一错误结构 —— 烂返回(200 + 模糊文案)vs 好返回(状态码 + {code,message})
// ---------------------------------------------------------------------------

// 烂返回:无论成功失败都 HTTP 200,把"出没出错"塞进 body 的一句模糊文案里。
// 调用方既不能靠状态码判断成败,也定位不到问题。
function badLogin(username, password) {
  if (!username || !password) {
    return { httpStatus: 200, body: { msg: '系统异常' } };       // 缺参也只给"系统异常"
  }
  if (password !== 'correct-password') {
    return { httpStatus: 200, body: { msg: '系统异常' } };       // 密码错也是"系统异常"
  }
  return { httpStatus: 200, body: { msg: 'ok' } };
}

// 好返回:用正确的 HTTP 状态码区分大类,body 给统一结构 { code, message, details? }。
// 状态码让调用方一眼分清是"自己传错(4xx)"还是"服务端的锅(5xx)";
// code 是机器可判定的稳定错误码,message 给人看,details 给可定位的字段级信息。
function goodLogin(username, password) {
  if (!username || !password) {
    return {
      httpStatus: 400, // Bad Request:调用方参数问题
      body: {
        code: 'INVALID_ARGUMENT',
        message: '缺少必填参数 username 或 password',
        details: [
          ...(username ? [] : [{ field: 'username', issue: 'required' }]),
          ...(password ? [] : [{ field: 'password', issue: 'required' }]),
        ],
      },
    };
  }
  if (password !== 'correct-password') {
    return {
      httpStatus: 401, // Unauthorized:认证失败
      body: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' },
    };
  }
  return {
    httpStatus: 200, // OK
    body: { code: 'OK', message: 'success', data: { token: 'a-jwt-token' } },
  };
}

module.exports = {
  OrderStore,
  createOrderNoIdempotency,
  makeIdempotentCreator,
  makeRows,
  offsetPage,
  cursorPage,
  badLogin,
  goodLogin,
};
