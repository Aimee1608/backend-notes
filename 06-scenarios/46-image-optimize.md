# 你以为图片压缩就是上传时处理一下

用户上传了一张 8MB 的原图，产品说"页面加载太慢，压缩一下"。

开发在上传接口里加了压缩逻辑，问题解决了——直到用户开始批量上传，接口响应时间从 200ms 变成了 3 秒，线程池被撑满，其他接口也开始超时。

图片压缩是 CPU 密集型操作，不能放在同步接口的请求链路里。

---

## 正确的处理时机：上传后异步处理

```
用户上传原图
    ↓
存储原图到 OSS（直传，不处理，快）
    ↓ 发消息
MQ Consumer 异步处理
    ├── 压缩（降质量）
    ├── 转格式（JPEG → WebP，体积减少 30-50%）
    └── 生成多尺寸（thumbnail 200px / medium 800px / original）
    ↓
把处理后的版本存回 OSS
    ↓
更新数据库：各尺寸的 URL
```

上传接口只做"收原图、存 OSS、发消息"三件事，响应速度极快。图片处理在后台异步跑，耗时不影响用户。

---

## 多尺寸版本的 URL 管理

不要在业务代码里硬拼 URL 后缀：

```java
// 不好的做法：URL 规则散落在各处
String thumbnailUrl = originalUrl.replace(".jpg", "_thumb.jpg");
```

应该在数据库里单独存每个版本的 URL：

```sql
CREATE TABLE image (
    id           BIGINT PRIMARY KEY,
    original_url VARCHAR(512),
    thumbnail_url VARCHAR(512),   -- 200px
    medium_url   VARCHAR(512),    -- 800px
    created_at   DATETIME
);
```

业务代码按需取对应尺寸，不依赖 URL 命名规则。

---

## CDN + 参数化处理：省掉预生成这一步

主流云存储（阿里云 OSS、腾讯云 COS、七牛云）支持**图片处理参数**，通过在 URL 上加参数实时处理：

```
# 原图 URL
https://cdn.example.com/user/avatar/abc.jpg

# 缩放到宽 200px，自动高度
https://cdn.example.com/user/avatar/abc.jpg?x-oss-process=image/resize,w_200

# 转 WebP 格式，质量 80
https://cdn.example.com/user/avatar/abc.jpg?x-oss-process=image/format,webp/quality,q_80

# 先缩放，再转 WebP（组合处理）
https://cdn.example.com/user/avatar/abc.jpg?x-oss-process=image/resize,w_800/format,webp
```

第一次请求时 OSS 实时处理，处理结果 CDN 缓存——后续相同参数的请求直接走 CDN，不再处理。

这样连预生成多尺寸都省了，前端需要什么尺寸就拼什么参数，灵活性更高。

---

## 不要在 API 服务里做图片处理

无论是压缩还是格式转换，ImageIO、PIL、sharp 这些库都会：

- 占用大量 CPU
- 在内存里展开整张图（8MB 的 JPEG 解码后可能是 100MB+ 的 bitmap）
- 处理时间不可控

API 服务器的线程是宝贵资源，要处理更多的并发请求，不是用来跑图片处理的。

图片处理要么交给 OSS/CDN（参数化实时处理），要么放到专门的 Worker 服务里异步跑，和主业务 API 隔离开。
