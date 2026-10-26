# AuthService

独立 .NET 8 认证服务，默认 `127.0.0.1:5105`。参考 GalReview 的 AuthService / UserService / Gateway 分工实现，使用 MySqlConnector 参数化 SQL、ASP.NET Core PasswordHasher 和服务端不透明令牌。

注册需要 **username、email、password、challengeId、verificationCode**，必须先获取邮箱验证码；登录使用 **email、password** 字段，其中 email 接受邮箱或用户名。邮箱统一转小写比较，用户名经 Unicode NFKC 和大小写规范化后唯一。新注册和修改后的密码为 6–128 字符，不会 trim；登录和验证当前密码仍接受最长 128 字符，以兼容已有账号（包括此前设置的较短密码）。使用带随机盐的 PBKDF2-SHA512 哈希（210,000 次迭代）。已有未验证账号仍可登录并在设置中补充验证；没有提供仅凭未验证邮箱修改密码或找回密码的入口。

## 分工和信任边界

- AuthService：邮箱、用户名预留、密码哈希、注册编排、访问/刷新令牌和会话。
- UserService：不可变用户名、可编辑显示名及简介。
- Gateway：注册验证码/注册/登录/刷新匿名白名单；其余接口验证 Bearer Token，向 AuthService 私有端点内省后注入 `X-User-Id` / `X-Session-Id`。
- 两个服务仅接受正确的 `X-Gateway-Key`；资料创建还须来自 Gateway 确认的 AuthService 调用方。
- 内省端点不加入 Gateway 公共路由；业务服务不会收到浏览器的 Bearer 或 Cookie。

注册先在 MySQL 预留 PROVISIONING 账号，经 Gateway 幂等创建资料，最后激活并建立会话。资料服务超时或进程崩溃不删除已有账号；使用相同用户名、邮箱及正确密码重试注册，或用正确密码登录，可以恢复未完成注册。不同密码不能认领预留账号。

## 数据库和启动

使用全新的 MySQL 数据库，**没有迁移、清空或重置旧数据库的逻辑**：

1. 管理员执行 [数据库创建脚本](../database/001-accounts.sql)，并创建只访问此新数据库的应用账号。
2. 将根目录 `.env.accounts.example` 复制为 `.env.accounts`，填写 `MYSQL_CONNECTION_STRING`。
3. 首次设置 `ACCOUNTS_INITIALIZE_SCHEMA=true`，服务会执行内嵌 `CREATE TABLE IF NOT EXISTS`；预先用管理员执行 `AccountShared/Schema/auth.sql` 和 `users.sql` 也可以。
4. 根目录运行 `./scripts/start-accounts.ps1`。默认 Gateway 为 `http://127.0.0.1:5088`，服务端口为 5141–5146。
5. 建表成功后将 `ACCOUNTS_INITIALIZE_SCHEMA=false`，运行账号可撤去 CREATE 权限。

该入口为 Auth/User 使用 MySQL，并为现有社交业务服务选择全新的 `.runtime/web/data/` JSON 目录，不读取 `.runtime/mvp/data/` 或桌面数据。本次没有将原有联系人、聊天、建议服务整体改写为 MySQL Repository。

单独启动需要：`ConnectionStrings__Accounts`、至少 32 字符的 `GATEWAY_KEY`、`SERVICE_CREDENTIAL`、`INTERNAL_GATEWAY_URL`，可选 `Accounts__InitializeSchema=true`。Gateway 必须配置对应 auth/user 下游密钥及 `Gateway__ServiceCredentials__AuthService`，开启 `Gateway__AccountAuth__Enabled=true`，关闭开发和桌面身份模式。

本机首次自动配置也可以使用 `node scripts/configure-accounts-db.mjs`：在 Git 忽略的 `.env.mysql-admin` 中填写 `MYSQL_ADMIN_CONNECTION_STRING` 后运行。工具只连接本机 MySQL；若目标库名已存在则选择新名称，不清空旧库；建立 5 张表，生成随机应用密码，只授予新库的 SELECT/INSERT/UPDATE/DELETE，并写入 `.env.accounts`，关闭自动建表。成功后移除仅含该管理员配置的临时输入文件。若 `.env.accounts` 已存在则拒绝覆盖。管理员密码不会出现在命令行参数或输出中。

## 邮箱配置

根目录复制 `.env.mail.example` 为 `.env.mail`，填写 163 邮箱、SMTP 授权码及至少 32 字符的随机 `EMAIL_VERIFICATION_SECRET`。默认使用 `smtp.163.com:465` 和 TLS；启动脚本仅向 AuthService 传入邮箱配置。该文件被 Git 忽略，验证密钥需持久保存，多实例使用相同值。

已有账号库运行 `node scripts/configure-email-verification.mjs`，从本地 `.env.mysql-admin` 读取一次性管理员连接，仅添加 `auth_email_challenges` 和 `auth_verified_emails` 两张表，不改已有账号。成功后删除临时管理员配置；`--check --skip-build` 可使用应用账号检查表是否就绪。

验证码由密码学随机数生成，10 分钟有效，60 秒后可重发，最多错误 5 次。数据库只保存绑定挑战 ID、邮箱和用途的 HMAC 摘要。验证成功即消费，重发使旧挑战失效。验证标记与新账号预留在同一事务内提交；资料服务失败可用原密码恢复。SMTP 提交失败返回 503 `EMAIL_DELIVERY_FAILED`，不会假装发送成功；服务端不会返回或记录验证码。

发码默认每 IP 每分钟 5 次，另有每邮箱每 15 分钟 20 次预算。已有账号可登录后验证本人邮箱，验证码不能跨邮箱、用户或用途使用。测试使用本机 SMTP 夹具和独立 MySQL，不发送真实邮件。

找回密码采用独立的 `PASSWORD_RESET` 用途，复用现有表结构，无需再次建表。仅对已验证邮箱且状态为 ACTIVE 的账号发送重置邮件；未知或未验证邮箱返回相同字段的条件性回执和相同冷却限制，不创建可用的重置证明。已有未验证账号仍可使用原密码登录，在设置中验证邮箱后再使用找回功能。新密码为 6–128 字符；密码哈希更新、验证码消费和所有会话撤销在一个事务内完成。成功后需重新登录，不自动创建会话。

## 管理员

管理员与普通账号共用登录入口。登录字段 email 同时接受用户名或邮箱；`GET /auth/account` 返回 role（USER / ADMIN），前端按服务端角色进入工作区或用户管理页。AuthService 每次管理请求均查询 auth_administrators，不信任用户名、前端状态或客户端角色头。普通注册保留 admin 用户名，不允许提交角色。

一次性初始化：在被 Git 忽略的 `.env.admin` 填 BETWEENLY_ADMIN_PASSWORD，在 `.env.mysql-admin` 填本机管理员数据库连接，然后运行 `node scripts/configure-administrator.mjs`。工具只向现有库添加管理员、封禁和审计三张表，事务创建管理员凭据及资料；已有同名普通账号时拒绝覆盖，已存在的管理员不会重置密码。成功后移除这两个临时输入文件。默认启动不会创建管理员或重设其密码。初始管理员按本机用户指定的密码建立，之后注册与重置仍要求 6–128 字符。

管理 API：GET `/api/v1/admin/users?q=&page=1` 返回 `{items,total,page,pageSize:20}`，GET `/api/v1/admin/users/{userId}` 返回账号资料及有效会话数，PUT `/api/v1/admin/users/{userId}/password` 接收 `{newPassword}`，成功 204。密码重置在同一事务中更新哈希、撤销目标用户全部会话、消费待用找回验证码，并记录操作者、目标、动作和时间。列表和资料不返回密码哈希、原密码或令牌。

PUT `/api/v1/admin/users/{userId}/ban` 接收 `{durationMinutes}`（整数 1–525600，null 为永久），DELETE 同一路径立即解封。封禁与踢下线、审计在同一事务中完成，登录、令牌内省和刷新都检查封禁状态；到期按数据库 UTC 时间自动失效，无需后台定时任务。解封后需重新登录，不恢复旧令牌。列表/详情返回 status=BANNED 及 banExpiresAt（永久为 null）。

DELETE `/api/v1/admin/users/{userId}` 将账号标记为 DELETED（软删除），从列表隐藏、禁止登录、撤销全部会话并消费待用验证码，保留历史数据和审计，邮箱/用户名仍保留占用。已删除账号不能通过解封或重置密码恢复。管理员不能删除或封禁自己的当前账号；UI 删除操作需一次明确确认。

## API 请求

统一响应：成功 `{data,meta,traceId}`，失败 `{data:null,error:{code,message,details},traceId}`。失败不返回密码、数据库细节或令牌。所有账号响应 `Cache-Control: no-store`。

| 方法 | Gateway 路径 | 认证 | 请求 |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/registration-codes` | 匿名 | `{email}`；邮件提交成功后返回 202 `{challengeId,expiresAt,retryAfterSeconds}` |
| POST | `/api/v1/auth/password-reset-codes` | 匿名 | `{email}`；返回 202 `{challengeId,expiresAt,retryAfterSeconds}`，仅向已验证的有效账号发信 |
| POST | `/api/v1/auth/password-resets` | 匿名 | `{email,challengeId,verificationCode,newPassword}`；成功返回 204 并撤销全部旧会话 |
| POST | `/api/v1/auth/registrations` | 匿名 | `{username,email,password,challengeId,verificationCode,deviceName?}` |
| POST | `/api/v1/auth/email-verification-requests` | Bearer | `{}`，向本人当前邮箱发码 |
| POST | `/api/v1/auth/email-verifications` | Bearer | `{challengeId,verificationCode}`，成功返回 `{emailVerified:true}` |
| POST | `/api/v1/auth/sessions` | 匿名 | `{email,password,deviceName?}` |
| POST | `/api/v1/auth/tokens` | 匿名 | `{refreshToken}` |
| GET | `/api/v1/auth/account` | Bearer | 当前邮箱、用户名及 实际 `emailVerified` 状态 |
| GET | `/api/v1/auth/sessions` | Bearer | 最近最多 100 条本人会话，不包含令牌/哈希 |
| DELETE | `/api/v1/auth/sessions/{sessionId}` | Bearer | 撤销本人会话，其他用户的 ID 返回 404 |
| POST | `/api/v1/auth/logout` | Bearer | 退出当前会话，不接受客户端指定 sessionId |
| PUT | `/api/v1/auth/password` | Bearer | `{currentPassword,newPassword}`；成功撤销本人全部会话 |

注册/登录返回 201：

```json
{
  "data": {
    "session": { "sessionId": "<uuid>", "userId": "<uuid>", "createdAt": "<UTC>", "expiresAt": "<UTC>" },
    "tokens": { "accessToken": "<opaque-token>", "refreshToken": "<opaque-token>", "tokenType": "Bearer", "expiresInSeconds": 900 }
  },
  "meta": {},
  "traceId": "<trace>"
}
```

后续调用发送 `Authorization: Bearer <accessToken>`。只在发放或轮换时返回原始令牌，数据库保存 SHA-256 摘要。访问令牌 15 分钟；刷新会话闲置 7 天、绝对 30 天。刷新在事务及行锁下轮换，旧访问令牌立即失效；重放已消费刷新令牌会撤销整个会话。调用方须串行刷新，不能把一次刷新请求当作可任意重试的幂等操作。

Gateway 的账号写操作默认每来源 IP 每分钟 60 次；AuthService 使用 MySQL 持久化每登录邮箱/操作的 15 分钟 20 次尝试预算，429 带 Retry-After。多 Gateway 实例时，IP 层预算仍是每实例，持久化邮箱层预算是共享的。反向代理部署须另行配置可信代理和入口总量限制。

## 验证

```powershell
# 由启动脚本构建，或分别在 Backend、Gateway 目录构建至 .runtime/accounts-build
node Backend/tests/accounts.integration.mjs
```

测试启动自己的 MySQL 实例，使用新的 `.runtime/accounts-test-*/mysql` 目录及随机端口，不访问已有 MySQL。默认 MySQL 工具目录为本机 `D:/IDE/mysql-8.4.4/bin`，其他机器通过 `BETWEENLY_TEST_MYSQL_BIN` 指定。测试覆盖注册、唯一约束、密码、令牌轮换、退出、资料版本、注册恢复、持久化和跨用户隔离。

## 当前范围

已实现邮箱验证、邮件找回密码、管理员用户管理及网页版账号页面。没有账号注销。服务只监听回环地址；公网部署须由 HTTPS 入口代理，不把数据库或内部端口公开。网页令牌只保存在内存，不写入 localStorage。

过期会话、刷新历史和限流行需要定期清理；刷新历史至少保留至对应会话绝对到期，避免提前丢失重放检测能力。
