// A zero-dependency in-memory message queue, for learning MQ core ideas.
// 用内存模拟一个最小可用的 MQ:produce / consume + 手动 ack + 失败重投 + 分区。
// 不依赖 Kafka / RabbitMQ,直接 `node demo.js` 就能跑,配套文章见同目录 README。

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let _msgSeq = 0; // 全局自增,给每条消息一个唯一的投递 id(区别于业务 id)

// 一条消息。
// - id:        每次"投递"都唯一(broker 内部用,重投会换新的)
// - bizId:     业务幂等键(同一业务事件多次投递,bizId 不变)—— 幂等去重靠它
// - key:       路由键,决定落到哪个分区(同 key 必落同一分区 → 同 key 有序)
// - payload:   业务数据
// - deliveries:这条业务消息被投递的次数(用来演示"至少一次"会重复)
class Message {
  constructor({ bizId, key, payload }) {
    this.id = ++_msgSeq;
    this.bizId = bizId;
    this.key = key;
    this.payload = payload;
    this.deliveries = 1;
  }
}

// 一个分区 = 一条有序队列(FIFO)。
// MQ 的"全局无序、分区内有序"就来自这里:单个分区内严格按入队顺序出队。
class Partition {
  constructor(index) {
    this.index = index;
    this.queue = []; // 待消费消息,数组头是队首
  }
  enqueue(msg) { this.queue.push(msg); }
  // 重投放回队首,尽量保持原有顺序(真实 MQ 行为更复杂,这里简化演示)。
  requeueFront(msg) { this.queue.unshift(msg); }
  dequeue() { return this.queue.shift(); }
  get size() { return this.queue.length; }
}

// 一个最小 MQ broker:一个 topic、多个分区、支持手动 ack 与失败重投。
//
// 关键模型:
//   producer → broker(按 key 把消息分到某个 partition)→ consumer 逐条取、处理、ack
//   - ack 成功:消息真正离开队列
//   - 没 ack(消费端"崩了"):消息重新投递(至少一次 at-least-once)
class MQBroker {
  constructor(opts = {}) {
    this.topic = opts.topic || 'topic';
    this.partitionCount = opts.partitions || 1;
    this.maxRetries = opts.maxRetries == null ? 3 : opts.maxRetries; // 超过则进死信
    this.verbose = opts.verbose || false;
    this.partitions = Array.from(
      { length: this.partitionCount },
      (_, i) => new Partition(i)
    );
    this.deadLetters = []; // 死信队列:重试用尽仍失败的消息
    this.deliverCount = 0; // 总投递次数(含重投),用来直观看"重复"
  }

  log(line) { if (this.verbose) console.log(`    [broker] ${line}`); }

  // 路由:同一个 key 永远落到同一个分区(哈希取模),这是"同 key 有序"的根。
  // 没传 key 的消息,均匀轮转分散到各分区(吞吐优先,不保证顺序)。
  pickPartition(key) {
    if (key == null) return Math.floor(Math.random() * this.partitionCount);
    let hash = 0;
    for (const ch of String(key)) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
    return Math.abs(hash) % this.partitionCount;
  }

  // 生产者发消息。confirm=true 表示开启"生产端确认":
  // 模拟一个可能丢的网络,只有 broker 真正收下并入队,才返回成功(false=没进来)。
  produce({ bizId, key, payload }, { confirm = false, dropRate = 0 } = {}) {
    // 模拟网络丢包:消息根本没到 broker。开了 confirm 才有机会发现并重发。
    if (dropRate > 0 && Math.random() < dropRate) {
      this.log(`PRODUCE LOST  bizId=${bizId}(网络丢包,没到 broker)`);
      return confirm ? false : true; // 不开 confirm:生产者以为成功了(消息其实丢了)
    }
    const msg = new Message({ bizId, key, payload });
    const p = this.partitions[this.pickPartition(key)];
    p.enqueue(msg);
    this.log(`ENQUEUE       bizId=${bizId} → partition#${p.index}`);
    return true;
  }

  // 消费一个分区里的所有消息。handler 是业务处理逻辑:
  //   - 正常返回    → 自动 ack,消息离开队列
  //   - 抛异常      → 不 ack,消息重投(deliveries+1),直到用尽重试 → 死信
  // ackMode='manual' 时由 handler 自己决定是否 ack(通过返回的对象)。
  async consumePartition(partition, handler, { label = 'consumer' } = {}) {
    while (partition.size > 0) {
      const msg = partition.dequeue();
      this.deliverCount++;
      try {
        await handler(msg, label);
        // handler 没抛错 = 处理成功 = ack。消息就此离开队列。
        this.log(`ACK           bizId=${msg.bizId} by ${label}`);
      } catch (err) {
        // 没 ack:消费端"处理中崩溃"。消息要重新投递,保证不丢(至少一次)。
        msg.deliveries++;
        if (msg.deliveries > this.maxRetries + 1) {
          this.deadLetters.push(msg);
          this.log(`DEAD-LETTER   bizId=${msg.bizId}(重试用尽,进死信队列)`);
        } else {
          this.log(
            `NACK→REQUEUE  bizId=${msg.bizId}(第 ${msg.deliveries - 1} 次处理失败,重投)`
          );
          partition.requeueFront(msg);
        }
      }
    }
  }

  // 消费整个 topic:每个分区独立、各自按序消费(同一分区单线程,保证分区内有序)。
  async consume(handler, opts = {}) {
    for (const p of this.partitions) {
      await this.consumePartition(p, handler, opts);
    }
  }

  get pendingTotal() {
    return this.partitions.reduce((s, p) => s + p.size, 0);
  }
}

// 一个最小的"幂等去重"工具:用业务唯一键记下"处理过的事件"。
// 重复投递的同一业务事件,第二次直接跳过 —— 这是消费端防重复的标准做法。
// 真实项目里这张"去重表"通常落在数据库(唯一索引)或 Redis,这里用内存 Set。
class IdempotencyGuard {
  constructor() { this.done = new Set(); }
  // 返回 true 表示"首次见到、可以处理";false 表示"处理过了,跳过"。
  firstTime(bizId) {
    if (this.done.has(bizId)) return false;
    this.done.add(bizId);
    return true;
  }
}

module.exports = { MQBroker, IdempotencyGuard, Message, sleep };
