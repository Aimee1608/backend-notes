# 微信换绑了手机号，原来的账号找不回来了

用户来客服说：之前用微信登录了 App，现在换了手机号，微信也重新绑定了新号，但进 App 之后账号里什么都没有——是个全新的账号。

问题不在微信，在平台侧的账号设计。

---

## 账号、身份、登录方式是三层概念

很多系统把这三个概念混在一起，出了问题才发现设计有缺陷：

- **账号（Account）**：平台侧的用户实体，有唯一 ID，承载所有用户数据
- **身份（Identity）**：证明"这是谁"的凭证——手机号、邮箱、微信 open_id 都是身份
- **登录方式**：用哪种身份来验证并获取账号访问权

错误的设计：账号 ID 就是手机号，或者账号 ID 就是微信 open_id。换了号，就换了账号。

正确的设计：账号 ID 是平台内部自增的独立 ID，身份和账号是多对一绑定关系——一个账号可以绑多个身份（手机号 + 微信 + 邮箱），任何一个身份都能找回同一个账号。

---

## 绑定表的设计

```sql
-- 账号主表（不存任何登录凭证）
CREATE TABLE account (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
    nickname    VARCHAR(64),
    avatar_url  VARCHAR(256),
    created_at  DATETIME
);

-- 身份绑定表（登录凭证在这里）
CREATE TABLE account_identity (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
    account_id  BIGINT NOT NULL,
    type        ENUM('PHONE', 'EMAIL', 'WECHAT', 'APPLE', 'GOOGLE'),
    identifier  VARCHAR(256) NOT NULL,  -- 手机号 / open_id / email
    created_at  DATETIME,
    UNIQUE KEY uk_type_id (type, identifier)
);
```

登录时的逻辑：用身份（type + identifier）查 `account_identity`，找到对应的 `account_id`，再去 `account` 表拿用户信息。

---

## 微信换号问题的根因

用户换手机号了，如果微信账号同时换了绑定号码，微信侧的 `open_id` 不变（open_id 是微信账号对应的，和手机号无关）。

但有些平台的实现是：把微信 open_id 和手机号直接关联存在一张表里，换号时更新了手机号字段，但没有维护到 `account_identity`，或者两套数据不同步，就出现了"认证通过了但账号对不上"的情况。

正确的做法：微信 open_id 对应一个身份记录，手机号对应另一个身份记录，两者独立，都指向同一个 `account_id`。用户换手机号只影响 `PHONE` 类型的身份记录，不影响 `WECHAT` 类型的记录，两个绑定互相不干扰。

---

## 多身份下的合并问题

用户先用手机号注册了账号 A，后来用微信登录，系统给微信 open_id 新建了账号 B——两个账号，数据分裂了。

这是没有做"已有账号绑定"流程导致的。正确流程：

1. 微信登录，发现 open_id 没有绑定记录
2. 提示用户：请验证手机号，将微信与已有账号关联
3. 用户验证手机号后，把 open_id 写入已有账号的 `account_identity`

如果跳过步骤 2，直接给 open_id 新建账号，账号就分裂了。事后合并账号非常麻烦：两个账号的订单、收藏、余额怎么合并，每个字段都要处理，且有数据冲突风险。

---

账号设计的核心原则：**账号 ID 是平台自己颁发的，独立于任何外部身份**。所有身份（手机号、open_id、邮箱）都是指向同一个账号的多把钥匙，钥匙可以换，账号不换。
