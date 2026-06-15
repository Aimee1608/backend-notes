// Run: `node demo.js`
// 跑两个示例服务("小服务"和"中等服务"),打印月成本明细表 + 总额 + 各项占比,
// 直观看到"一个服务一个月烧多少钱、钱花在哪"。
//
// 注意:下面所有单价都是【示例值】,只为演示算账思路。
// 真实价格随云厂商 / 地域 / 规格 / 折扣浮动很大,务必以云厂商官网价目表为准。
const { estimateMonthlyCost, money } = require('./lib');

// 画一根可视化占比条:share=0.5 → 半根条。纯展示,让占比"看得见"。
function bar(share, width = 20) {
  const filled = Math.round(share * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// 打印一个场景的完整成本明细表。
function printScenario(name, input) {
  const r = estimateMonthlyCost(input);
  console.log(`\n=== ${name} ===`);
  console.log(`  峰值 ${input.peakQps} QPS,单台扛 ${input.qpsPerInstance} QPS → 需要 ${r.instances} 台实例\n`);

  // 表头
  console.log('  ' + '成本项'.padEnd(12) + '金额'.padEnd(14) + '占比'.padEnd(8) + '明细');
  console.log('  ' + '─'.repeat(64));

  // 各项明细(已按金额从大到小排好序)
  for (const it of r.items) {
    const pct = (it.share * 100).toFixed(1) + '%';
    console.log(
      '  ' +
        it.name.padEnd(12) +
        money(it.amount).padEnd(14) +
        pct.padEnd(8) +
        bar(it.share, 12) +
        '  ' +
        it.detail
    );
  }

  console.log('  ' + '─'.repeat(64));
  console.log('  ' + '月总成本'.padEnd(12) + money(r.total));
  console.log('  ' + '年总成本'.padEnd(12) + money(r.total * 12) + '   (月成本 × 12,粗估)');
}

function main() {
  console.log('服务月成本估算器 —— 所有单价均为【示例值】,以云厂商官网为准\n');

  // 场景一:小服务(内部工具 / 小流量 API)
  // 峰值不高,一两台实例就够,流量和存储都很小 —— 大头通常在数据库这类"固定包月"上。
  printScenario('场景一 · 小服务(低流量内部 API)', {
    peakQps: 100,
    qpsPerInstance: 200,
    instancePrice: 300, // 示例:一台 2C4G 通用实例 ~￥300/月,以官网为准
    rdsPrice: 400, // 示例:入门级 RDS ~￥400/月,以官网为准
    redisPrice: 150, // 示例:小规格 Redis ~￥150/月,以官网为准
    trafficGb: 200,
    trafficPricePerGb: 0.8, // 示例:公网出口 ~￥0.8/GB,以官网为准
    storageGb: 100,
    storagePricePerGb: 0.12, // 示例:对象存储 ~￥0.12/GB·月,以官网为准
    logGb: 50,
    logPricePerGb: 0.7, // 示例:日志存储+检索综合 ~￥0.7/GB,以官网为准
  });

  // 场景二:中等服务(对外业务 API,峰值 1000 QPS)
  // 实例多了、流量大了,大头往往转移到"计算 + 公网流量"上 —— 这正是降本要先盯的地方。
  printScenario('场景二 · 中等服务(对外 API,峰值 1000 QPS)', {
    peakQps: 1000,
    qpsPerInstance: 200,
    instancePrice: 300, // 同上,示例值
    rdsPrice: 1200, // 示例:中等规格 RDS(主从)~￥1200/月,以官网为准
    redisPrice: 600, // 示例:中等规格 Redis ~￥600/月,以官网为准
    trafficGb: 5000,
    trafficPricePerGb: 0.8, // 示例值
    storageGb: 2000,
    storagePricePerGb: 0.12, // 示例值
    logGb: 800,
    logPricePerGb: 0.7, // 示例值
  });

  console.log('\n提示:改改上面任一个用量 / 单价,再跑一遍,看总额和占比怎么变 ——');
  console.log('      尤其把「公网流量 GB」调大,体会为什么大文件一定要走 CDN。\n');
}

main();
