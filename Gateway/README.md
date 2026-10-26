# Gateway

## UserService / AuthService

正式网页账号入口使用 `Gateway__AccountAuth__Enabled=true`，同时关闭 DevelopmentAuth 和 DesktopAuth。注册验证码 `POST /api/v1/auth/registration-codes`、密码找回发码 `POST /api/v1/auth/password-reset-codes`、重置 `POST /api/v1/auth/password-resets`、注册 `POST /api/v1/auth/registrations`、登录 `POST /api/v1/auth/sessions`、刷新 `POST /api/v1/auth/tokens` 为显式匿名白名单；其他公开接口要求 Bearer Token，经 AuthService 私有内省后取得 userId/sessionId。认证服务故障返回 503，不能回退到开发身份。`/internal/v1/auth/introspections` 不提供网关公共路由。

UserService 负责 `/api/v1/users/me`。AuthService 通过服务密钥和 acting-user 作用域调用 `POST /internal/v1/users` 创建资料，其他调用方不能调用该内部接口。外部的 Authorization、Cookie、X-User-Id、X-Session-Id、X-Caller-Service 及服务身份头不会直接传给业务服务，Gateway 只注入验证后的身份。

配置必须包含 `auth-service`、`user-service` 下游的 BaseUrl/GatewayKey（至少 32 字符），以及 `Gateway__ServiceCredentials__AuthService`。账号模式默认关闭，保留已有本地 MVP/桌面启动方式。完整启动、MySQL 建表及接口说明见 [AuthService](../Backend/AuthService/README.md)。

部署在反向代理之后时，仅通过 `Gateway__TrustedProxies__0` 等配置指定可信代理 IP；未配置时不信任客户端自带 Forwarded/X-Forwarded-For。配置后最多处理一层转发，鉴权限流使用确认后的客户端 IP。浏览器 Origin 仍需在 Cors.AllowedOrigins 中明确允许，公网入口提供 HTTPS。

Betweenly 的 C#/.NET 网关，契约依据为根目录 [contract.md](../contract.md)。工程、构建配置、测试和文档均位于本目录，可独立构建；程序集和命名空间为 `SocialAssistant.Gateway`。

## 构建与启动

需要 .NET SDK 8.0.403 或同系列兼容补丁版本；测试还需要 Node.js 和 PowerShell 7。以下命令在 `Gateway` 目录执行：

```powershell
dotnet restore Gateway.sln --configfile NuGet.Config
dotnet build Gateway.sln --configuration Debug --no-restore
dotnet run --project Gateway.csproj
```

使用启动配置时默认运行在 Development，监听 `http://127.0.0.1:5080`。从仓库根目录开始时，先执行 `Set-Location Gateway`，让 dotnet 使用本目录 `global.json` 指定的 .NET 8 SDK。

## 前端联调

本地前端约定使用 **3000** 端口；Gateway 的前端 API 入口为 **http://127.0.0.1:5080/api/v1**。

```text
前端开发地址：http://localhost:3000 或 http://127.0.0.1:3000
前端 API_BASE_URL：http://127.0.0.1:5080/api/v1
```

Gateway 已为这两个开发来源启用 `/api/...` 的 CORS 预检、契约请求头和必要响应头读取。开发请求仍需携带下文的 `X-Dev-User-Id`。前端位于根目录 `frontend`，业务服务位于 `Backend`；可通过根目录 `scripts/start-mvp.ps1` 一起启动。

允许来源由 `Gateway:Cors:AllowedOrigins` 配置；调整前端端口时同步修改该列表。生产默认列表为空，部署时通过 `Gateway__Cors__AllowedOrigins__0` 等配置提供实际前端来源。此跨域策略不应用于 `/internal/...`。

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

Electron 桌面运行是独立的本地身份例外：`Gateway:DesktopAuth:Enabled=true` 时，仅接受回环连接和本次启动生成的 `X-Desktop-Token`，用户固定为 `Gateway:DesktopAuth:UserId`；不回退开发身份。令牌由 Electron 主进程持有，通过 `betweenly://app/api/v1` 代理注入，渲染页面不可读取。Gateway 向下游转发时剥离此令牌。桌面模式不会开放 INTERNAL 路由，也不代表已实现远程用户登录。

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

2026-10-24 验证结果：编译零警告、零错误；冒烟测试通过；专项回归 **30 组通过、0 项偏差**，其中 5 组覆盖前端 CORS。10 项修复与验证对应关系见 [检查报告](docs/gateway-contract-review.md)。

## 后续工作

正式身份与用户状态验证、限流及契约请求大小限制、生产 INTERNAL 网络隔离、完整结构化日志和配置校验仍需补齐。下游业务服务尚未实现；所有下游启动前 `/readyz` 返回 503 属于预期行为。
