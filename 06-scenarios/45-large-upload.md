# 大文件上传怎么设计：分片、断点续传、秒传

大文件上传（比如 2GB 的视频），浏览器直接整包 POST 的结果几乎注定：传到一半超时断掉，从头再来，再断。

做大文件上传之前，要明确三件事：**分片、断点续传、秒传**。三件事不是一件事，实现复杂度逐级递增。

---

## 分片上传

把大文件切成固定大小（如 5MB）的片，逐片上传，全部传完后通知后端合并：

**前端**：
```javascript
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB
const chunks = [];
for (let start = 0; start < file.size; start += CHUNK_SIZE) {
    chunks.push(file.slice(start, start + CHUNK_SIZE));
}
// 并发上传所有分片（控制并发数，如同时传 3 片）
await Promise.all(chunks.map((chunk, i) => uploadChunk(uploadId, i, chunk)));
// 全部完成后通知合并
await mergeChunks(uploadId, chunks.length);
```

**后端**接收分片，按 `uploadId + chunkIndex` 存储，收到 merge 请求后顺序拼接：

```java
public void mergeChunks(String uploadId, int totalChunks) throws IOException {
    Path targetFile = Paths.get(UPLOAD_DIR, uploadId, "merged");
    try (OutputStream out = Files.newOutputStream(targetFile)) {
        for (int i = 0; i < totalChunks; i++) {
            Path chunkFile = Paths.get(UPLOAD_DIR, uploadId, "chunk_" + i);
            Files.copy(chunkFile, out);
        }
    }
}
```

---

## 断点续传

用户传到第 6 片断网了，重新上传时不要从头开始。

服务端记录哪些分片已经上传成功：

```java
// 客户端上传前先查：哪些分片已存在
public List<Integer> getUploadedChunks(String uploadId) {
    return chunkDao.getUploadedIndexes(uploadId);
}
```

前端拿到已上传列表后，跳过这些分片，只传缺失的。

`uploadId` 由服务端在开始上传前颁发（`POST /upload/init`），客户端将其持久化（localStorage），断线重连后用同一个 uploadId 继续。

---

## 秒传

文件 MD5 相同，说明内容完全一致——服务端已有这个文件，不需要再传一遍：

```java
// 上传前先检查 MD5
public UploadCheckResult checkMd5(String md5) {
    FileRecord existing = fileDao.findByMd5(md5);
    if (existing != null) {
        return UploadCheckResult.instant(existing.getUrl()); // 秒传成功，直接返回 URL
    }
    String uploadId = generateUploadId();
    uploadSessionDao.create(uploadId, md5);
    return UploadCheckResult.needUpload(uploadId);
}
```

秒传的前提是服务端有中心化存储，文件去重在存储层实现（同一 MD5 只存一份，多个用户引用同一个 object key）。

---

## 用 OSS 原生分片上传，不要自己写合并

上面的合并逻辑自己实现，需要磁盘 I/O、需要管理临时文件清理，还有合并失败的容错处理——很麻烦。

阿里云 OSS / 腾讯云 COS / AWS S3 都有原生的分片上传 API：

1. `InitiateMultipartUpload` → 得到 `uploadId`
2. 客户端直传每个分片到 OSS（`UploadPart`），带 `uploadId` + `partNumber`
3. 所有分片传完，调 `CompleteMultipartUpload`——OSS 自己合并

客户端直传 OSS，不走你的服务器，节省带宽和服务器内存。服务端只需要给前端颁发有时效的 STS 临时凭证用于直传授权。

---

三件能力——分片、断点续传、秒传——按需选，不是每个场景都要全上。文件小（< 100MB）只需要分片；只有用户会频繁上传重复文件才值得做秒传。复杂度由需求决定，不是越全越好。
