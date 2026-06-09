// Run: `node demo.js`
// 用一个内存版 MQ,把消息队列最该懂的几件事跑给你看:
// 解耦、至少一次投递(防丢)、重复消费 + 幂等、分区顺序。
const { MQBroker, IdempotencyGuard } = require('./lib');

function title(t) { console.log(`\n=== ${t} ===`); }
function line(label, value) { console.log(`  ${String(label).padEnd(28)} ${value}`); }

// ── 场景一:异步解耦 ──────────────────────────────────────────────
// 下单只负责"发一条订单创建消息",谁来消费、消费几次,它一概不管。
// 短信服务、积分服务各订各的,各自处理 —— 这就是解耦 + 广播。
async function decoupling() {
  title('场景一 · 异步解耦:下单发一条消息,多个下游各取所需');
  const broker = new MQBroker({ topic: 'order.created', partitions: 1 });

  // 生产者:下单成功,只发一条消息就返回(不等下游做完)。
  broker.produce({ bizId: 'order-1001', payload: { user: 'Alice', amount: 99 } });
  console.log('  [下单服务] 已发出 order.created 消息,立即返回(不等下游)');

  // 多个独立消费者,各自处理同一条订单事件。
  console.log('  ── 下游开始各自消费 ──');
  await broker.consume(async (msg) => {
    await new Promise((r) => setTimeout(r, 5));
    console.log(`    [短信服务]   给 ${msg.payload.user} 发下单成功短信`);
  });
  // 重新发一条,演示第二个下游(真实场景里两个下游同时订阅同一 topic)。
  broker.produce({ bizId: 'order-1001', payload: { user: 'Alice', amount: 99 } });
  await broker.consume(async (msg) => {
    await new Promise((r) => setTimeout(r, 5));
    console.log(`    [积分服务]   给 ${msg.payload.user} 加 ${msg.payload.amount} 积分`);
  });
  console.log('  一句话:下单不关心下游是谁、做什么,新增/挂掉一个下游都不影响它。');
}

// ── 场景二:消息丢失防护(至少一次投递)─────────────────────────
// 消费端"处理到一半崩了"(抛异常 = 没 ack),消息不会丢,会被重新投递。
// 这就是"至少一次(at-least-once)":宁可重复,也不丢。
async function atLeastOnce() {
  title('场景二 · 防丢失:处理中崩溃没 ack,消息重回队列被重投');
  const broker = new MQBroker({ topic: 'order.pay', partitions: 1, maxRetries: 3, verbose: true });
  broker.produce({ bizId: 'pay-1', payload: { order: 1001 } });

  let attempt = 0;
  await broker.consume(async (msg) => {
    attempt++;
    if (attempt < 3) {
      // 模拟:第 1、2 次处理到一半进程崩了 —— 没 ack。
      throw new Error('consumer crashed before ack');
    }
    // 第 3 次终于处理成功并 ack。
    console.log(`    [消费成功]    bizId=${msg.bizId},累计被投递 ${msg.deliveries} 次`);
  });
  line('总投递次数(含重投)', broker.deliverCount + '   ← 失败会重投,所以 > 1');
  line('最终是否丢失', broker.pendingTotal === 0 ? '没丢,已成功消费' : '仍在队列');
  console.log('  一句话:只要"处理完再 ack",消费端崩了也不丢 —— 代价是可能重复(见场景三)。');
}

// ── 场景三:重复消费 + 幂等 ──────────────────────────────────────
// 网络重试 / ack 丢失,会让同一条业务消息被投递两次。
// 不做幂等:积分被加两次(错)。用去重表(记 bizId):只生效一次(对)。
async function idempotency() {
  title('场景三 · 重复消费 + 幂等:同一条消息投两次,积分该加几次?');

  // A. 没有幂等保护:来几次加几次。
  {
    const broker = new MQBroker({ topic: 'order.points', partitions: 1 });
    let points = 0;
    broker.produce({ bizId: 'order-2002', payload: { add: 50 } });
    broker.produce({ bizId: 'order-2002', payload: { add: 50 } }); // 重复投递(同一 bizId)
    await broker.consume(async (msg) => { points += msg.payload.add; });
    line('无幂等,最终积分', points + '   ← 同一订单被加了两次(错!应是 50)');
  }

  // B. 加幂等保护:同一 bizId 只认第一次。
  {
    const broker = new MQBroker({ topic: 'order.points', partitions: 1 });
    const guard = new IdempotencyGuard();
    let points = 0;
    broker.produce({ bizId: 'order-2002', payload: { add: 50 } });
    broker.produce({ bizId: 'order-2002', payload: { add: 50 } }); // 同样重复投递
    await broker.consume(async (msg) => {
      if (!guard.firstTime(msg.bizId)) return; // 处理过了,直接跳过(但仍 ack)
      points += msg.payload.add;
    });
    line('有幂等,最终积分', points + '   ← 用 bizId 去重,只生效一次(对)');
  }
  console.log('  一句话:消费端必须幂等 —— 用业务唯一键去重,重复执行结果不变。');
}

// ── 场景四:顺序 ─────────────────────────────────────────────────
// 同一订单的多条消息(创建→支付→发货)必须按序处理。
// 散到多分区 → 各分区被并行消费,合起来可能乱序;
// 路由到同一分区(同 key)→ 单线程按序消费 → 严格有序。
async function ordering() {
  title('场景四 · 顺序:同一订单的"创建→支付→发货"');
  const steps = ['创建', '支付', '发货'];

  // A. 三条消息散到三个不同分区(用不同 key)。真实 MQ 里各分区由不同消费者
  //    并行处理,谁先处理完不确定 —— 这里给各分区不同的处理耗时来模拟这种并行,
  //    于是合起来的完成顺序就乱了。
  {
    const broker = new MQBroker({ topic: 'order.flow', partitions: 3 });
    // key 取 'p0'/'p1'/'p2',刚好哈希到三个不同分区,一步一个分区。
    const keys = ['p0', 'p1', 'p2'];
    steps.forEach((s, i) =>
      broker.produce({ bizId: `evt-${i}`, key: keys[i], payload: { step: s } })
    );
    const got = [];
    // 模拟"各分区并行消费":给每个分区不同延迟(创建最慢、发货最快),
    // 完成顺序由快慢决定,而非发送顺序 —— 这正是多分区丢失全局顺序的根因。
    const delays = { 创建: 30, 支付: 20, 发货: 10 };
    await Promise.all(
      broker.partitions.map((p) =>
        broker.consumePartition(p, async (msg) => {
          await new Promise((r) => setTimeout(r, delays[msg.payload.step]));
          got.push(msg.payload.step);
        })
      )
    );
    const ok = got.join('→') === steps.join('→');
    line('多分区(各分区并行)消费顺序', got.join('→') + (ok ? '' : '   ← 乱了!'));
  }

  // B. 同一 key(订单号)→ 三条都落同一分区 → 单线程按序消费 → 一定有序。
  //    即便给同样的并行延迟,同分区也是一条处理完才取下一条,顺序不会乱。
  {
    const broker = new MQBroker({ topic: 'order.flow', partitions: 3 });
    steps.forEach((s, i) =>
      broker.produce({ bizId: `evt-${i}`, key: 'order-3003', payload: { step: s } })
    );
    const got = [];
    const delays = { 创建: 30, 支付: 20, 发货: 10 };
    await broker.consume(async (msg) => {
      await new Promise((r) => setTimeout(r, delays[msg.payload.step]));
      got.push(msg.payload.step);
    });
    line('同 key(同分区)消费顺序', got.join('→') + '   ← 严格有序');
  }
  console.log('  一句话:MQ 不保证全局有序;同一类消息用同一 key 路由到同一分区,才有序。');
}

async function main() {
  await decoupling();
  await atLeastOnce();
  await idempotency();
  await ordering();
  console.log('\n提示:把幂等开关 / 分区数 / 重试次数改一改再跑,体会每个机制的作用。\n');
}

main();
