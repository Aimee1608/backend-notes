// A zero-dependency monthly cost estimator for a typical backend service.
// 一个"服务月成本估算器":把计算 / 数据库 / 缓存 / 流量 / 存储 / 日志各项加起来,
// 算出一个月大概烧多少钱,并打印每项占比 —— 让你直观看到"钱花在哪"。
//
// 重要:本文件里出现的所有单价都是【示例值】,只为演示"怎么算这笔账"。
// 真实价格随云厂商、地域、规格、折扣浮动很大,务必以云厂商官网价目表为准。

// 向上取整:实例数必须是整数,且要能扛住峰值,所以是 ceil 而不是四舍五入。
const ceil = (n) => Math.ceil(n);

// 把数字格式化成带千分位的金额字符串(￥1,234.56),纯展示用。
function money(n) {
  return '￥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// 核心函数:输入一套用量 + 单价,输出每一项的费用、总额、以及各项占比。
//
// input 字段(单位都标在注释里;****单价均为示例值,以官网为准****):
//   peakQps          峰值 QPS(每秒请求数)
//   qpsPerInstance   单台实例能稳定承载的 QPS(压测得出,这里取经验值)
//   instancePrice    单台实例的月单价(￥/台·月)        —— 计算(CPU/内存)
//   rdsPrice         云数据库 RDS 的月单价(￥/月)        —— 数据库
//   redisPrice       云缓存 Redis 的月单价(￥/月)        —— 缓存
//   trafficGb        每月公网出口流量(GB)
//   trafficPricePerGb 公网流量单价(￥/GB)               —— 流量/带宽
//   storageGb        对象存储用量(GB)
//   storagePricePerGb 对象存储单价(￥/GB·月)            —— 存储
//   logGb            每月日志量(GB,含存储+检索的估算)
//   logPricePerGb    日志单价(￥/GB·月)                 —— 日志
function estimateMonthlyCost(input) {
  // 1) 计算费:先按峰值 QPS 算出需要几台实例(向上取整),再乘以单价。
  //    例:1000 QPS,单台扛 200,就需要 ceil(1000/200)=5 台。
  const instances = ceil(input.peakQps / input.qpsPerInstance);
  const compute = instances * input.instancePrice;

  // 2) 数据库 / 缓存:云上一般是包月的托管实例,直接用月单价。
  const database = input.rdsPrice;
  const cache = input.redisPrice;

  // 3) 流量费:公网出口按 GB 计费,是最容易被忽视、也最容易爆的一项。
  const traffic = input.trafficGb * input.trafficPricePerGb;

  // 4) 对象存储:按 GB·月 计费,单价低但冷数据堆久了也是钱。
  const storage = input.storageGb * input.storagePricePerGb;

  // 5) 日志:量大、且检索/索引另收费,这里用一个综合单价粗估。
  const logs = input.logGb * input.logPricePerGb;

  // 各项汇总成一张明细表。
  const items = [
    { name: '计算(实例)', amount: compute, detail: `${instances} 台 × ${money(input.instancePrice)}/台` },
    { name: '数据库 RDS', amount: database, detail: '包月托管实例' },
    { name: '缓存 Redis', amount: cache, detail: '包月托管实例' },
    { name: '公网流量', amount: traffic, detail: `${input.trafficGb} GB × ${money(input.trafficPricePerGb)}/GB` },
    { name: '对象存储', amount: storage, detail: `${input.storageGb} GB × ${money(input.storagePricePerGb)}/GB` },
    { name: '日志', amount: logs, detail: `${input.logGb} GB × ${money(input.logPricePerGb)}/GB` },
  ];

  const total = items.reduce((sum, it) => sum + it.amount, 0);

  // 给每一项算占比(钱花在哪),并按金额从大到小排,方便一眼看出大头。
  const withShare = items
    .map((it) => ({ ...it, share: total === 0 ? 0 : it.amount / total }))
    .sort((a, b) => b.amount - a.amount);

  return { instances, items: withShare, total };
}

module.exports = { estimateMonthlyCost, money };
