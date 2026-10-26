# UserService

独立 .NET 8 / MySQL 用户资料服务，默认 `127.0.0.1:5106`。配置和整体启动见 [AuthService 文档](../AuthService/README.md)。

资料表 `user_profiles`，建表定义为 `AccountShared/Schema/users.sql`。不存密码、认证令牌或模型密钥；账号资料通过 userId 与 AuthService 关联。

| 方法与路径 | 功能 |
| --- | --- |
| `GET /api/v1/users/me` | 当前用户的 userId、username、displayName、bio、version、createdAt、updatedAt |
| `PATCH /api/v1/users/me` | 更新 displayName（1–64 字符）和/或 bio（0–500 字符） |
| `POST /internal/v1/users` | AuthService 经 Gateway 创建资料，接受 `{userId,username}`；相同 userId/username 重试幂等 |

所有接口只接受 Gateway 服务密钥。公共接口从受信 `X-User-Id` 取当前用户，不接受用户在 body 指定归属；内部创建要求 `X-Caller-Service: AuthService`，且 body.userId 与 Gateway 确认的 acting user 一致。Gateway 会丢弃客户端伪造的这些头。

用户名注册后不可修改；显示名初始为用户名。PATCH 必须带 `If-Match: "<version>"`，使用带 userId 和 version 的原子更新，冲突返回 `409 VERSION_CONFLICT`，禁止更新 username、email、role 或 userId。读取及更新成功返回 ETag。

`/healthz` 为存活状态；`/readyz` 检查 MySQL 和资料表是否可用。日志只输出标准控制台，不依赖 Windows EventLog。
