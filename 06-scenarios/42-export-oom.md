# 你以为数据导出就是查数据库然后写文件

10 万行 Excel 导出，开发写完本地测几十条没问题，上线后用户一点导出——服务器内存突然飙到顶，接着 OOM，进程挂了。

定位问题只花了 5 分钟：

```java
// 问题代码
List<OrderRecord> all = orderDao.findAll(query);   // 一次性把 10 万行全捞到内存
Workbook wb = buildExcel(all);                     // 再占一份内存
response.getOutputStream().write(wb.toByteArray()); // 再压一份到字节数组
```

三份数据同时在内存里。10 万行，每行几十个字段，几百 MB 起步。

---

## 分页查询 + 流式写入

不能一次全捞，改成分批读、边读边写：

```java
// 使用 EasyExcel 流式写入（写完即刷，不在内存积累）
try (ExcelWriter writer = EasyExcel.write(response.getOutputStream(), OrderRecord.class).build()) {
    WriteSheet sheet = EasyExcel.writerSheet("订单").build();
    
    int page = 0, size = 1000;
    List<OrderRecord> batch;
    do {
        batch = orderDao.findPage(query, page++, size);
        writer.write(batch, sheet);
        batch.clear(); // 尽快 GC
    } while (batch.size() == size);
}
```

每次只有 1000 行在内存，EasyExcel 写完这批就刷到输出流，内存占用基本恒定。

---

## 同步导出的问题

即使用了流式写入，同步接口还有另一个坑：

- 10 万行查询 + 写入可能要 30 秒
- HTTP 超时（Nginx 默认 60s）
- 用户等待体验差

数据量超过 1 万行，换成**异步任务**：

```
用户点导出 → 后端创建导出任务（task_id）→ 立即返回
                          ↓（异步）
             Worker 查询 + 生成文件 + 上传 OSS
                          ↓
             推送通知 or 轮询接口 → 用户拿到下载链接
```

```java
// 创建任务
public String submitExport(ExportQuery query, long userId) {
    ExportTask task = new ExportTask(userId, query, TaskStatus.PENDING);
    taskDao.insert(task);
    mqProducer.send(new ExportTaskMessage(task.getId()));
    return task.getId();
}

// 查询任务状态
public ExportTaskVO getStatus(String taskId) {
    ExportTask task = taskDao.getById(taskId);
    return new ExportTaskVO(task.getStatus(), task.getDownloadUrl());
}
```

---

## 文件放哪

不要让文件从服务器直接走 HTTP 流输出给用户——并发导出时，服务器带宽会被占满。

标准做法：生成的文件上传到 OSS（阿里云/腾讯云/MinIO），生成带过期时间的下载链接（7 天内有效）返回给用户。用户直接从 OSS 拉文件，不走你的服务器。

---

## 导出任务的幂等

同一个导出请求，用户重复点击会创建多个任务。在任务创建时加幂等键（如 `userId + 查询参数 hash`），同一参数在 N 分钟内只创建一个任务，返回同一个 taskId：

```java
String idempotentKey = DigestUtils.md5Hex(userId + JSON.toJSONString(query));
ExportTask existing = taskDao.getByIdempotentKey(idempotentKey);
if (existing != null && existing.isRecentlyCreated()) {
    return existing.getId();
}
```

避免用户着急多次点击，堆了几十个相同的导出任务。
