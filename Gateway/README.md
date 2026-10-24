# Gateway

Betweenly 的 C#/.NET 网关，契约依据为根目录 [contract.md](../contract.md)。工程、构建配置、测试和文档均位于本目录，可独立构建；程序集和命名空间为 `SocialAssistant.Gateway`。

## 构建与启动

需要 .NET SDK 8.0.403 或同系列兼容补丁版本；测试还需要 Node.js 和 PowerShell 7。以下命令在 `Gateway` 目录执行：

```powershell
dotnet restore Gateway.sln --configfile NuGet.Config
dotnet build Gateway.sln --configuration Debug --no-restore
dotnet run --project Gateway.csproj
```

使用启动配置时默认运行在 Development，监听 `http://127.0.0.1:5080`。从仓库根目录开始时，先执行 `Set-Location Gateway`，让 dotnet 使用本目录 `global.json` 指定的 .NET 8 SDK。

## 路由与身份

- `/api/v1/...` 使用契约公共路由白名单，将请求转发给各数据所有者服务。
- `/internal/v1/...` 验证服务密钥和接口调用方白名单；服务名 `AdviceService`、`ContactContextService` 区分大小写。
- 客户端伪造的用户、网关和服务身份头在转发前剥离；Gateway 注入可信用户、目标独立密钥及单个关联 ID。
- 资源路径参数要求小写 UUID v4；格式错误返回 `400 VALIDATION_ERROR`，未知路径返回 404，错误方法返回 405 和 Allow。
- `/healthz` 表示存活；`/readyz` 调用四个必需下游的 `/readyz`，任一未就绪或缺少配置则返回 503。

开发公共请求示例：

```http
X-Dev-User-Id: 7bc4918a-9079-4ea2-9e8e-369ad79a9f20
```

开发身份同时要求实际环境为 `Development` 且 `Gateway:DevelopmentAuth:Enabled=true`。即使非开发环境误开此配置，也不会接受开发身份头。正式 Bearer 认证方案仍为 OWNER-TBD，当前非开发环境拒绝公共请求。

内部调用示例：

```http
X-Service-Name: AdviceService
X-Service-Key: dev-advice-service-key
X-Acting-User-Id: 7bc4918a-9079-4ea2-9e8e-369ad79a9f20
```

## 代理行为

- 不自动跟随下游重定向；3xx 转换为统一的 503 错误，不向 Location 发送密钥或用户身份。
- 不使用共享 Cookie 容器，避免跨用户自动保存或发送下游 Cookie。
- 已符合契约的下游错误保留状态、业务错误码及 details，使用当前链路 traceId；非 JSON、畸形或超过 64 KiB 的错误正文转换为安全错误信封。
- 配置的请求预算同时覆盖响应头、成功正文和错误正文。响应已开始后超时则终止连接，避免拼接半个成功结果和错误 JSON。
- AnalysisService 超时使用 `504 MODEL_TIMEOUT`，不可达使用 `503 MODEL_UNAVAILABLE`；普通下游分别使用 `GATEWAY_TIMEOUT`、`SERVICE_UNAVAILABLE`。
- 转换错误时保留 Allow、Retry-After 和 WWW-Authenticate 协议头。

## 配置

| 服务 | 开发端口 |
| --- | ---: |
| ExpressionStyleService | 5101 |
| ContactContextService | 5102 |
| AdviceService | 5103 |
| AnalysisService | 5104 |

可通过环境变量覆盖服务地址、密钥、就绪路径和预算，例如：

```text
Gateway__Services__advice-service__BaseUrl
Gateway__Services__advice-service__GatewayKey
Gateway__Services__advice-service__HealthPath
Gateway__ServiceCredentials__AdviceService
Gateway__RequestTimeoutSeconds
Gateway__ReadinessTimeoutSeconds
```

配置中的开发密钥仅供本地联调；正式服务地址和独立密钥由部署环境提供。契约中的逻辑服务标识仍为 `api-gateway`。

## 测试

构建后在本目录执行：

```powershell
./scripts/test-gateway.ps1 -SkipBuild
node tests/gateway/contract-audit.mjs
```

冒烟测试使用 5101–5104 和 58080 端口；专项回归使用随机本地端口和虚构密钥，直接读取契约中的 27 个公共路由及 5 个 INTERNAL 接口，结束后清理测试进程。

2026-10-24 验证结果：编译零警告、零错误；冒烟测试通过；专项回归 **25 组通过、0 项偏差**。10 项修复与验证对应关系见 [检查报告](docs/gateway-contract-review.md)。

## 后续工作

正式身份与用户状态验证、限流及契约请求大小限制、生产 INTERNAL 网络隔离、完整结构化日志和配置校验仍需补齐。下游业务服务尚未实现；所有下游启动前 `/readyz` 返回 503 属于预期行为。
