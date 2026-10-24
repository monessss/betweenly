# Gateway 契约修复与验证

日期：2026-10-24。依据：根目录 `contract.md` v0.2。前次检查复现的 10 项问题已修复，回归由原来的 5 组通过、10 项偏差变为 **25 组通过、0 项偏差**。

## 工程迁移

Gateway 已独立置于仓库根目录，包含 `Gateway.csproj`、`Gateway.sln`、构建配置、源码、启动配置、脚本、测试与本文档。旧 backend 中的 Gateway 文件、空目录及重复 README 已清理。

```text
Gateway/
├── Gateway.csproj
├── Gateway.sln
├── Directory.Build.props
├── global.json
├── NuGet.Config
├── Program.cs
├── Configuration/
├── Http/
├── Properties/
├── Proxy/
├── Routing/
├── Security/
├── scripts/
├── tests/gateway/
└── docs/
```

程序集与命名空间为 `SocialAssistant.Gateway`。根目录契约已同步工程位置，API 地址和契约逻辑服务标识未改变。根目录及 Gateway 的 `.gitignore` 覆盖生成产物与本地私有配置。

## 10 项修复

| 原问题 | 修复位置与行为 | 验证 |
| --- | --- | --- |
| 重定向携带服务密钥访问其他地址 | [Program.cs](../Program.cs) 禁用自动重定向；[GatewayProxy.cs](../Proxy/GatewayProxy.cs) 将 3xx 转换为统一 503 | 跳转目标未收到任何请求 |
| 下游 Cookie 跨用户共享 | [Program.cs](../Program.cs) 对代理及探测客户端关闭 Cookie 容器 | 用户 A 收到 Set-Cookie 后，用户 B 请求不自动附带该 Cookie |
| 非开发环境误开配置后可伪造身份 | [UserIdentityResolver.cs](../Security/UserIdentityResolver.cs) 同时检查 Development 环境及配置开关 | Production 即使打开开关仍返回 401；合法 INTERNAL 调用仍可用 |
| INTERNAL 服务名大小写不敏感 | [GatewayRoute.cs](../Routing/GatewayRoute.cs) 和 [GatewayOptions.cs](../Configuration/GatewayOptions.cs) 使用 Ordinal 比较 | `adviceservice` 被拒绝，规范值和相应密钥通过 |
| 关联 ID 被转发两次 | [ApiErrorWriter.cs](../Http/ApiErrorWriter.cs) 缓存规范化 ID；代理跳过原始头再注入一次 | 下游仅收到一个 ID；缺失时上下游与响应头一致 |
| 下游错误不符合统一信封 | [GatewayProxy.cs](../Proxy/GatewayProxy.cs) 验证并重建错误响应，诊断读取限制 64 KiB | 普通文本、畸形及超大错误正文转换成功；合法业务码、details 和 Retry-After 保留 |
| 超时未覆盖正文 | [GatewayProxy.cs](../Proxy/GatewayProxy.cs) 对响应头及全部正文读取使用同一取消预算 | 延迟成功正文、延迟错误正文受限；已开始的部分成功正文在超时时终止连接 |
| 分析超时错误码错误 | [GatewayProxy.cs](../Proxy/GatewayProxy.cs) 按目标区分模型与普通服务失败 | 分析超时为 `MODEL_TIMEOUT`，连接中断为 `MODEL_UNAVAILABLE` |
| 就绪只检查下游存活 | 默认及开发配置、[ReadinessProbe.cs](../Proxy/ReadinessProbe.cs) 改查必需下游 `/readyz`，并检查路由所需服务是否存在 | 下游存活但未就绪时 Gateway 返回 503；全部就绪后恢复 200 |
| 畸形 UUID 被当作路由不存在 | [RouteCatalog.cs](../Routing/RouteCatalog.cs) 先匹配结构，再用 [ContractUuid.cs](../Http/ContractUuid.cs) 验证小写 UUID v4 | 畸形、大小写、版本及 variant 错误返回 400；未知路径仍为 404，错误方法为 405 |

错误归一化还保留 Allow、Retry-After 和 WWW-Authenticate，并统一错误信封中的 traceId；不会将下游 HTML 或诊断正文当作业务错误信息直接返回。

## 验证命令与结果

在 `Gateway` 目录运行：

```powershell
dotnet restore Gateway.sln --configfile NuGet.Config
dotnet build Gateway.sln --configuration Debug --no-restore
./scripts/test-gateway.ps1 -SkipBuild
node tests/gateway/contract-audit.mjs
```

- 编译：0 个警告、0 个错误。
- 现有代理冒烟测试：通过。
- 专项回归：`Audit: 25 passed, 0 deviations.`，退出码 0。
- 路由覆盖：从契约直接读取的 27 个公共方法/路径组合、5 个 INTERNAL 接口及调用方 allowlist。
- 测试均使用本地模拟下游及虚构密钥，没有调用真实业务服务或模型供应商。

## 本轮之外的未完成能力

正式 Bearer 身份与用户状态验证、限流与契约请求大小限制、INTERNAL 的生产网络隔离、完整请求日志及部署配置校验，仍属于后续工作。相关身份方案、额度和部署参数在契约中标为 OWNER-TBD，不能将本次 10 项修复等同于完整生产验收。

联系人所有权、幂等、删除协调、Schema 和模型结果校验归相应业务服务所有，需在这些服务实现后做集成验收。当前工作目录没有 `.git`，本次未创建 Git 提交。
