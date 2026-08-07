# 批量打包下载：用户选了 200 个文件，内存扛不住

用户在文件管理页勾选了 200 个合同文件，点"打包下载"。

后端的实现：把 200 个文件都读到内存，zip 压缩，写到 response 流。200 个文件平均 1MB，就是 200MB 堆内存——并发 10 个用户同时打包，2GB 内存光这一个接口就占满了。

---

## 流式 ZIP：边读边写，不在内存积累

```java
response.setContentType("application/zip");
response.setHeader("Content-Disposition", "attachment; filename=files.zip");

try (ZipOutputStream zos = new ZipOutputStream(
        new BufferedOutputStream(response.getOutputStream()))) {

    for (FileItem file : fileList) {
        zos.putNextEntry(new ZipEntry(file.getName()));
        // 从 OSS 流式读取，写入 zip 流
        try (InputStream in = ossClient.getObject(file.getOssKey()).getObjectContent()) {
            byte[] buf = new byte[8192];
            int len;
            while ((len = in.read(buf)) != -1) {
                zos.write(buf, 0, len);  // 每次只占 8KB 缓冲
            }
        }
        zos.closeEntry();
    }
}
```

整个过程内存里只有 8KB 的读缓冲区，无论多少个文件都不会因为文件总量撑内存。

流式输出的限制：不能设置 `Content-Length`（因为压缩后大小在写完前不知道），浏览器看不到下载进度条。这在大多数场景可以接受。

---

## 同步还是异步

| 场景 | 方案 |
|------|------|
| 文件数量少（< 20 个），总大小 < 50MB | 同步流式输出 |
| 文件数量多或体积大 | 异步任务：后台生成 ZIP，上传 OSS，发下载链接 |

异步方案的流程：

```
用户提交打包请求 → 创建 task，返回 taskId
          ↓（Worker 异步执行）
    从 OSS 流式读取每个文件 → 写入 ZipOutputStream → 目标是 OSS 的 PutObject 流
          ↓
    ZIP 文件上传完成，生成带过期时间的下载链接
          ↓
    通知用户（站内信 / App Push）→ 用户点击链接直接从 OSS 下载
```

Worker 里也要用流式写入，只是目标从 `response.getOutputStream()` 换成了 OSS 的 multipart upload 接口。

---

## OSS 直链 vs 打包

如果文件本来就在 OSS 上，有时候不需要打包，直接给用户多个 OSS 直链更省事：

- 200 个文件 → 生成 200 个带签名的临时 URL（有效期 1 小时）
- 前端用 `<a download>` 或 JS 批量触发下载

浏览器对同时下载的文件数量有限制（通常 6 个），但逐个排队下载对用户透明，用户体验比等待 ZIP 生成快很多。

打包下载更适合：文件数量极多（几百上千）、用户需要在本地保持目录结构、文件需要二次处理不适合直链暴露。

---

## 大 ZIP 的清理

异步生成的 ZIP 文件放在 OSS 上，要设置过期时间（生命周期规则），比如 7 天自动删除，避免存储费用无限累积。下载链接的有效期和 ZIP 的存储期要对齐，否则文件删了链接还有效，用户点了报 404。
