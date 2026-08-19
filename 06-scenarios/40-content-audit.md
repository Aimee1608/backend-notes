# 内容审核怎么选：先审后发，还是先发后审

UGC 平台的内容审核有两条路：**先审后发** vs **先发后审**。

在讨论技术方案之前，先要问产品和法务：**这个平台能承受多少风险窗口？**

---

## 两种策略的核心权衡

**先审后发**

用户发布内容 → 进入审核队列 → 审核通过后可见

- 违规内容不会被任何人看到
- 用户体验差：发完看不到，以为发失败了；审核有延迟，内容时效性受影响
- 适合：强监管内容（医疗建议、金融信息、儿童内容）、对违规零容忍的平台

**先发后审**

用户发布内容 → 立刻可见 → 异步送审 → 审核未通过则下架

- 用户体验好，发完即见
- 违规内容有短暂可见窗口（通常几分钟到几小时，取决于审核速度）
- 适合：低风险社区类内容、对时效性要求高的平台

---

## 混合策略：按风险分级

不是所有内容都一样危险，更合理的做法是按内容风险分级处理：

```
内容提交
    ↓
机审（秒级）
    ├─ 确定违规 → 拒绝，不发布
    ├─ 确定安全（低风险）→ 直接发布，不再人审
    └─ 不确定（含图片、敏感关键词命中）→ 先发后审（人工队列）
                                              └─ 人审通过 → 保持可见
                                              └─ 人审拒绝 → 下架 + 通知用户
```

代码层面，内容状态机：

```java
public enum ContentStatus {
    PENDING,   // 待审核（先审后发时，此状态内容不可见）
    PUBLISHED, // 已发布可见
    REJECTED,  // 审核拒绝，不可见
    REMOVED    // 先发后审被下架
}
```

查询时按状态过滤：`WHERE status = 'PUBLISHED'`

---

## 先发后审的实现细节

内容创建后直接写入 DB，状态设为 `PUBLISHED`，同时发消息给审核队列：

```java
@Transactional
public void publishContent(Content content) {
    content.setStatus(ContentStatus.PUBLISHED);
    content.setAuditStatus(AuditStatus.PENDING);  // 审核状态独立
    contentDao.insert(content);
    
    auditMqProducer.send(new AuditTask(content.getId()));
}
```

审核完成回调：

```java
public void onAuditResult(long contentId, boolean passed) {
    if (!passed) {
        contentDao.updateStatus(contentId, ContentStatus.REMOVED);
        notifyUser(contentId, "您的内容因违反社区规范已被移除");
    }
}
```

审核状态（`audit_status`）和发布状态（`status`）分开存：审核状态是内部运营字段，发布状态是面向用户的展示字段，两者独立维护，互不耦合。

---

## 机审接入

自己写规则引擎处理不了图片、语音、视频。接入第三方内容安全 API（如阿里云内容安全、腾讯天御）是标准做法：

- 文本：关键词过滤 + 语义分析
- 图片：涉黄/涉暴/广告识别
- 视频：抽帧送图片审核

机审 API 是外部调用，要做超时和降级：超时时进人工审核队列（不能因为机审挂了就让所有内容绕过审核直接发）。

---

## 用户告知

无论哪种策略，让用户看到自己内容的审核状态，是减少客诉的最直接方式：

- 先审后发：发布后显示"内容审核中，审核通过后将对外展示"
- 先发后审被下架：明确告知原因，提供申诉入口
- 长时间未审核：超过 N 小时未出结果，发通知给用户并升级处理优先级
