# Betweenly API 接口与数据契约

> 版本：v0.2  
> 状态：`DRAFT BASELINE`，供原型和并行开发使用；不代表功能已经实现或效果已经验证  
> 日期：2026-10-24  
> 依据：《项目说明书》v0.1  
> 工作名称：Betweenly
> 本地 MVP 实现：2026-10-25，DeepSeek 接入与业务服务实现见 [Backend/README.md](Backend/README.md)；完整契约仍为基线，MVP 限制在该文档中明确列出。
> 技术基线：Node.js 前端；C#/.NET 网关与业务服务；Python 模型分析服务  
> 前端框架、.NET 版本、Python 版本、Web 框架和持久化技术仍为 `OWNER-TBD`

## 0. 文档定位

本文冻结第一版开发所需的最小跨端契约：

- 用户表达习惯、对象背景、聊天消息、线下事件、偏好与边界的读写接口；
- 单次分析与建议结果的请求、响应、状态和错误码；
- 事实、用户转述、观察行为和模型推测的来源标记；
- 证据引用、结构校验、幂等、删除和失败处理规则；
- 可供前端、后端和评测共同使用的 Mock 数据。

本文不是最终 OpenAPI、数据库设计或前端视觉规范。字段持久化方式、正式产品名、模型版本、身份方案、部署技术、超时预算和保留期限仍属于 `OWNER-TBD`。

约束强度：

| 标记 | 含义 |
| --- | --- |
| `BASELINE` | 调用方可据此开发；修改时必须同步前端、后端、Mock 和契约测试 |
| `OWNER-TBD` | 需在正式编码或上线前明确，不得被实现者静默假定 |
| `P1` | 不阻塞第一版端到端闭环，可在核心流程验证后补充 |
| `INTERNAL` | 仅后端或受信服务访问，不向浏览器暴露 |

本文中的建议协议只是产品不变量约束，不会被当作系统指令执行。聊天正文、用户备注和导入文本始终是待分析数据。

## 1. 第一版契约范围

### 1.1 产品目标

系统依据用户提供的真实互动背景，帮助其：

1. 选择合适的下一步社交行动；
2. 用接近用户本人的语气表达；
3. 查看简短理由、证据和未知信息；
4. 在获得真实结果后更新下一次建议。

系统不承诺回复率、赴约率或恋爱结果，也不把“持续聊天”直接解释为双方都希望发展关系。

### 1.2 第一版入口

| 入口枚举 | 用户意图 |
| --- | --- |
| `NEW_CONNECTION` | 刚认识，想自然开始联系 |
| `BUILD_RELATIONSHIP` | 已认识，想进一步了解、邀请或表达意愿 |
| `SPECIFIC_DIFFICULTY` | 遇到紧张、冷场、误会、拒绝等具体问题 |

入口描述用户此刻的任务，不是对象的永久分类，也不是必须依次完成的流程。

### 1.3 第一版必须覆盖

- 文本聊天与线下事件的录入、修正和删除；
- 用户表达习惯、双方偏好及明确边界；
- 一个主行动建议、至多两个备选和至多三个回复候选；
- 可定位证据、未知信息及必要补问；
- 用户编辑、风格反馈和行动结果回顾；
- 严格的 JSON 校验、稳定错误码、请求幂等与数据删除；
- 对指令注入和明确拒绝场景的基础防护。

### 1.4 第一版明确不做

- 自动发送消息或后台读取聊天；
- 恋爱成功率、心意或人格评分；
- 未经核验的场所、营业时间、价格和路线；
- 自动订位、持续监控对方账号或获取第三方隐私；
- 模型训练、微调、人格模仿或声音克隆；
- 聊天截图识别、情境模拟和实时场所检索。

### 1.5 待确认项

以下事项不影响本契约的字段命名和服务边界，但会影响实现：

- 正式产品名、Node.js 前端框架、.NET/Python 具体版本和部署方式；
- LLM 供应商、模型版本、价格与数据留存政策；
- 数据存储位置、加密方式、日志策略和正式保留期限；
- 调用超时、重试次数、上下文 token 上限和限流额度；
- 人工评测样本量及上线阈值。

## 2. 核心语义

### 2.1 证据不是事实结论

“她接受了周六喝咖啡的邀请”是事件。  
“她喜欢我”是可能成立的解释，不能自动写成已确认事实。

每条需要长期保存的偏好、边界和行为都应保留来源。重要观察和建议必须引用具体证据。证据存在不等于证据支持结论，后者仍需语义评测。

### 2.2 事实与推测分开

`FACT` 只能复述输入中可定位的内容，不能补充输入未说明的动机、关系状态或共同经历。

`INFERENCE` 必须明确标为推测，不能自动写入已确认偏好档案，也不能用“因此她一定喜欢你”式结论代替不确定性。

### 2.3 用户决定

- 所有建议均可编辑；
- 任何消息只有用户审阅后才能由用户自行发送；
- 系统不把用户未采纳的候选写入表达习惯；
- 用户明确修正后，新记录才能替代旧记录。

### 2.4 双方意愿与边界

明确拒绝、不愿意继续联系、不喜欢的话题或称呼属于硬约束，不能被其他积极互动抵消。

一次“哈哈”、没有反对、过去接受过某个玩笑或曾经答应过某种互动，都不能自动解释为当前持续同意。

## 3. 架构边界

### 3.1 服务化调用链

```text
Node.js Frontend
  -> C# API Gateway
     -> C# ExpressionStyleService
     -> C# ContactContextService
     -> C# AdviceService
          -> Gateway INTERNAL -> ExpressionStyleService
          -> Gateway INTERNAL -> ContactContextService
          -> Gateway INTERNAL -> Python AnalysisService
                                  -> external LLM provider
          -> schema / evidence / boundary validation
          -> persist advice result
  -> Node.js Frontend
```

- 浏览器只调用 Gateway 的 `/api/v1/...` 路由。
- Gateway 负责鉴权、路由、限流、链路头和统一错误映射，不拥有社交业务事实。
- C# 服务负责身份后的数据所有权、业务状态、幂等、引用校验和结果持久化。
- Python `AnalysisService` 只处理已经由 C# 服务组装并授权的上下文，负责模型调用和单次结构化生成。
- Python 服务不读取业务数据库、不决定用户身份、不保存联系人、建议或反馈。
- 模型密钥和供应商密钥只存在于受控服务端环境。
- 当前实现使用 DeepSeek 生成与 TypeSafe Jev 复核，必要时修改一次；有限调用预算见 8.3。
- 第一版使用同步内部 HTTP 调用，不引入 RabbitMQ。将来引入异步任务时，必须保持本文的请求幂等和结果校验语义。

### 3.2 信任边界

- 客户端传入的 `ownerUserId`、角色、权限和审计字段一律不可信。
- 当前用户身份由后端会话或受信认证中间件确定。
- 聊天、备注和导入内容中的“忽略规则”“输出密钥”“调用某工具”等文本只作为数据记录。
- 模型输出不是可信系统指令，只有通过 Schema 和业务校验后才可返回或缓存。

### 3.3 服务目录

| 服务 | 语言 | 拥有的职责 | 明确不负责 |
| --- | --- | --- | --- |
| `api-gateway` | C#/.NET | 公共路由、身份验证、限流、关联 ID、INTERNAL 调用方鉴权、错误信封归一化 | 保存社交数据、组装提示词、判断关系阶段 |
| `expression-style-service` | C#/.NET | 用户表达习惯的读取、替换、删除和版本控制 | 联系人背景、对方偏好、建议结果 |
| `contact-context-service` | C#/.NET | 联系人、聊天消息、线下事件、偏好与边界、硬约束、上下文查询和隐私删除 | 调用 LLM、生成回复、保存建议结果 |
| `advice-service` | C#/.NET | 分析请求编排、幂等、上下文范围校验、分析结果校验、建议与反馈持久化 | 管理原始聊天、长期保存用户表达习惯、直接操纵模型内部状态 |
| `analysis-service` | Python | 接收已组装上下文、调用 LLM、返回符合版本化 Schema 的分析结果 | 身份、数据库访问、跨联系人检索、自动发送、最终安全检查 |

`social-contracts` 是 C# 共享契约库，不是独立运行服务。Python 侧必须有与其等价的请求/响应模型，并通过版本化 JSON Schema 契约测试保持同步。

### 3.4 数据所有权

| 数据 | 唯一权威服务 | 其他服务的使用方式 |
| --- | --- | --- |
| 用户表达习惯、风格版本 | `expression-style-service` | 通过 INTERNAL 查询，不直接写库 |
| 联系人、消息、事件、偏好、边界 | `contact-context-service` | 通过 INTERNAL 上下文查询获得最小子集 |
| 分析请求、建议、反馈 | `advice-service` | 通过 PUBLIC API 或受控 INTERNAL 接口访问 |
| 行动结果事件 | `contact-context-service` | AdviceService 请求其创建，并保存 `relatedAdviceId` |
| 模型原始响应及临时推理上下文 | `analysis-service` 进程内临时内存 | 默认不持久化；失败或完成后按保留策略清理 |
| 身份凭证、会话和令牌 | 外部身份服务或 `OWNER-TBD` 身份模块 | Gateway 仅验证，不向其他业务服务传播令牌 |

约束：

- 每个服务拥有独立逻辑数据库或独立 schema；第一版不得使用共享数据库表绕过服务 API。
- 不允许跨服务数据库 JOIN、直连读取或双写同一业务事实。
- Gateway 和 AnalysisService 不使用业务数据库。
- 联系人删除、撤回同意或记录替代必须由数据所有者执行，其他服务只保存必要的引用或删除墓碑。
- 持久化产品未确定前，内存仓储只能用于本地原型和契约测试，不能宣称为生产数据方案。

### 3.5 正常分析调用顺序

1. Node.js 前端携带用户令牌、`Idempotency-Key` 和分析请求调用 Gateway。
2. Gateway 验证身份和请求范围，注入可信 `X-User-Id`、`X-Correlation-Id`，路由到 AdviceService。
3. AdviceService 校验联系人及所选证据属于当前用户，并检查幂等键。
4. AdviceService 经 Gateway INTERNAL 向 ExpressionStyleService 读取表达习惯；未配置时可使用中性默认值。
5. AdviceService 经 Gateway INTERNAL 向 ContactContextService 请求已选证据和所有适用硬边界。
6. AdviceService 组装 `AnalysisInput`，经 Gateway INTERNAL 调用 Python AnalysisService。
7. AnalysisService 调用 LLM，只返回待校验的结构化结果，不直接返回给浏览器。
8. AdviceService 校验 Schema、引用、状态联合约束和结构化硬边界。
9. 校验通过后，AdviceService 持久化结果并返回 Gateway；任一步失败时不得返回半成品建议。
10. 用户反馈由 AdviceService 保存；真实行动结果由 AdviceService 请求 ContactContextService 创建事件。

### 3.6 INTERNAL 路由与身份

内部路由统一位于 `/internal/v1/...`，只允许 Gateway 暴露给受信服务，不向浏览器或公网开放。

最小内部接口目录：

| 方法 | INTERNAL 路由 | 调用方 | 目标服务 | 用途 |
| --- | --- | --- | --- | --- |
| `GET` | `/internal/v1/users/{userId}/expression-style` | AdviceService | ExpressionStyleService | 读取分析所需表达习惯 |
| `POST` | `/internal/v1/context-queries` | AdviceService | ContactContextService | 返回当前用户、指定联系人和证据子集，并自动纳入硬边界 |
| `POST` | `/internal/v1/contacts/{contactId}/outcomes` | AdviceService | ContactContextService | MVP 增补：创建已验证建议的真实后续事件，载荷为 EventInput，relatedAdviceId 由 AdviceService 设置 |
| `POST` | `/internal/v1/analysis` | AdviceService | AnalysisService | 执行结构化分析、生成与复核，正常返回 `200` |
| `POST` | `/internal/v1/advice-evidence-deletions` | ContactContextService | AdviceService | 删除引用了待删除消息、事件或边界记录的分析 |
| `DELETE` | `/internal/v1/users/{userId}/advice-data` | ContactContextService | AdviceService | 删除当前用户全部建议和反馈 |

内部调用约束：

- 服务调用 Gateway 时发送 `X-Service-Name` 和非空的 `X-Service-Key`；Gateway 校验调用方与目标接口的 allowlist。
- 用户作用域的内部调用还必须发送 `X-Acting-User-Id`；Gateway 验证服务身份后将其转换为目标服务可信的 `X-User-Id`。
- `X-Service-Name` 的当前规范值为 `AdviceService` 和 `ContactContextService`，大小写敏感；内部路由键如 `advice-service` 仅用于部署配置，不能作为调用方身份。
- Gateway 转发前剥离 `X-Service-Key`，注入目标服务自己的 `X-Gateway-Key` 和已验证的 `X-User-Id`。
- 目标服务必须校验 `X-Gateway-Key`；缺失、错误或重复 header 返回 `403 FORBIDDEN`。
- `/internal/v1/analysis` 只允许 `AdviceService` 调用，浏览器身份、ContactContextService 和其他服务均不得调用。
- ContactContextService 只能使用指定删除接口回调 AdviceService，不能读取建议数据库。
- 服务到服务调用禁止自行保存其他服务的实例地址；地址和密钥由部署配置提供。
- 除健康检查外，内部接口不得匿名访问。
- `/internal/v1/analysis` 以 `requestId + 规范化输入 checksum` 作为进程内短期幂等键；同一键和相同输入返回原结果，不重复调用模型；同一键对应不同输入返回 `409 IDEMPOTENCY_KEY_REUSED`。

### 3.7 跨服务失败处理

| 失败点 | AdviceService 行为 | 对外结果 |
| --- | --- | --- |
| 表达习惯不存在 | 使用明确的中性默认风格 | 可继续分析 |
| 表达习惯服务不可用 | 不静默丢弃用户风格 | `503 SERVICE_UNAVAILABLE` |
| 联系人不存在或不属于用户 | 终止分析，不向模型发送请求 | `404 RESOURCE_NOT_FOUND` |
| 上下文服务不可用 | 终止分析 | `503 SERVICE_UNAVAILABLE` |
| Python 分析超时 | 终止分析，不保存建议 | `504 MODEL_TIMEOUT` |
| Python 服务不可用 | 终止分析，不保存建议 | `503 MODEL_UNAVAILABLE` |
| 模型输出不合契约 | 有限重试；持续失败则不保存、不展示 | `502 MODEL_OUTPUT_INVALID` |
| 建议持久化失败 | 不返回“已保存”成功结果 | `500 INTERNAL_ERROR` 或明确的重试结果 |

Python 服务失败时不能由 C# 使用模板文本伪装成正常分析结果。C# 可以返回自己的结构化错误或要求补问，但不能声称模型已成功完成分析。

### 3.8 版本与发布边界

- 公共契约主版本位于 URL，例如 `/api/v1`。
- AdviceService 与 AnalysisService 的请求都携带 `schemaVersion`；不兼容时返回 `422 ANALYSIS_SCHEMA_UNSUPPORTED`，不能按字段猜测解释。
- 新增可选字段是兼容变更，但 C# DTO、Python 模型、JSON Schema 和 Mock 必须同批更新。
- 服务可独立部署，但一次端到端发布必须声明 Gateway、C# 服务和 Python 服务支持的契约版本。
- AnalysisService 的模型、提示词和规则版本必须进入 `engineVersion`；同一 `engineVersion` 不得静默对应不同生产规则。

### 3.9 部署与可观测性边界

| 服务 | 公网暴露 | 健康检查 | 独立密钥/配置 |
| --- | --- | --- | --- |
| Node.js Frontend | 是 | 由前端部署决定 | 不持有任何服务密钥 |
| C# `api-gateway` | 是 | `/healthz`、`/readyz` | 用户令牌验证配置、各目标服务地址与服务密钥 |
| C# `expression-style-service` | 否 | `/healthz`、`/readyz` | `X-Gateway-Key`、数据库连接 |
| C# `contact-context-service` | 否 | `/healthz`、`/readyz` | `X-Gateway-Key`、数据库连接、AdviceService 内部地址 |
| C# `advice-service` | 否 | `/healthz`、`/readyz` | `X-Gateway-Key`、数据库连接、模型分析服务地址 |
| Python `analysis-service` | 否 | `/healthz`、`/readyz` | `X-Gateway-Key`、LLM 供应商配置 |

- 业务服务不得共享数据库账号、写入账户或持久化卷。
- Gateway 和生产网络只允许必要路由通过；Python 分析端口不得映射到宿主机公网。
- 所有服务日志记录 `traceId`、服务名、状态、耗时和结果码，默认不记录聊天正文、模型完整提示词、用户令牌或服务密钥。
- `/healthz` 只证明进程存活；`/readyz` 发现必需依赖或 Schema 资产不可用时返回 `503`。
- 具体容器编排、端口、副本数、超时和资源限制属于 `OWNER-TBD`，但不得改变本文的逻辑边界。

## 4. 公共 HTTP 契约

### 4.1 请求头

| Header | 必填 | 说明 |
| --- | ---: | --- |
| `Authorization: Bearer <token>` | 受保护路由 | 当前身份由后端验证，浏览器不得提交可信用户 ID 代替 |
| `Content-Type: application/json` | JSON 请求 | 上传功能不在第一版范围内 |
| `X-Correlation-Id` | 建议 | 缺失时由 Gateway 生成并回传 |
| `Idempotency-Key` | 创建分析等写接口 | UUID；相同键和语义相同的载荷返回同一业务结果 |
| `If-Match` | 更新或删除受保护资源时 | 使用资源当前 `version` 或 ETag，防止覆盖并发修改 |
| `X-Service-Name` | 服务调用 Gateway INTERNAL | 与 `X-Service-Key` 同时提交；浏览器同名头必须被丢弃 |
| `X-Service-Key` | 服务调用 Gateway INTERNAL | 仅由 Gateway 校验调用方，转发前必须剥离 |
| `X-Acting-User-Id` | 服务调用 Gateway INTERNAL | 服务本次调用所代表的用户；Gateway 校验服务身份后转换为可信 `X-User-Id` |
| `X-User-Id` | Gateway -> 业务服务 | 由已验证用户身份产生；外部同名头必须被丢弃 |
| `X-Gateway-Key` | Gateway -> 业务服务 | 目标服务独立密钥；浏览器和调用方服务不得自行注入 |

网页账号模式采用 AuthService 服务端不透明 Bearer 令牌，Gateway 通过私有内省逐次验证会话并注入受信用户身份；注册为用户名、邮箱、密码、challengeId 和六位 verificationCode，须先通过匿名 POST /api/v1/auth/registration-codes 获取验证码；登录为邮箱与密码。验证码 10 分钟有效、60 秒可重发、最多 5 次错误，重发使旧验证码失效。已有账号可通过 Bearer POST /auth/email-verification-requests 与 POST /auth/email-verifications 验证当前邮箱。找回密码使用匿名 POST /api/v1/auth/password-reset-codes（email）和 POST /api/v1/auth/password-resets（email、challengeId、verificationCode、newPassword）；只接受已验证的有效账号，未知/未验证邮箱获得相同结构的条件性回执。找回验证码独立绑定用途，重置成功 204，原子消费验证码、更新密码并撤销所有旧会话。新注册和修改后的密码为 6–128 个字符；登录及验证当前密码兼容已有密码（上限 128 字符）。接口及令牌轮换规则见 [AuthService](Backend/AuthService/README.md)，用户资料规则见 [UserService](Backend/UserService/README.md)。开发/桌面身份仅在显式对应模式可用，与网页账号模式互斥。账号注销仍属于后续功能，现有 context-data 清除接口不等同于账号注销。

### 4.2 公共数据类型

```ts
type Uuid = string;          // UUID v4，小写连字符形式
type DateTime = string;      // RFC 3339；有已知时区时为 ISO 8601 字符串
type EvidenceRef = string;   // message:{uuid} | event:{uuid} |
                             // preference:{uuid} | ephemeral:{key}
type Cursor = string;        // 不透明分页游标
type JsonObject = Record<string, unknown>;

type EntryPoint =
  | "NEW_CONNECTION"
  | "BUILD_RELATIONSHIP"
  | "SPECIFIC_DIFFICULTY";

type AssertionSource =
  | "COUNTERPART_EXPLICIT"   // 对方明确表达或可核对的原话
  | "USER_SELF_REPORT"       // 用户说明自己的感受、目标或习惯
  | "USER_RELAY"             // 用户对对方话语或经历的转述
  | "OBSERVED_BEHAVIOR"      // 可观察行为，不含动机解释
  | "MODEL_INFERENCE";       // 模型推测，只能待确认
```

日期未知时必须使用 `null`，不能猜测后补全。消息没有可靠顺序时，不得用当前录入时间冒充发送时间。

### 4.3 统一成功响应

```ts
interface ApiSuccess<T, M = Record<string, never>> {
  data: T;
  meta: M;
  traceId: string;
}
```

```json
{
  "data": {
    "status": "ok"
  },
  "meta": {},
  "traceId": "01JQ2K8P5D8M4K4MB4S6V9A2R1"
}
```

### 4.4 统一错误响应

```ts
interface ApiError {
  code: string;
  message: string;
  details: JsonObject;
}

interface ApiFailure {
  data: null;
  error: ApiError;
  traceId: string;
}
```

```json
{
  "data": null,
  "error": {
    "code": "CONTEXT_SCOPE_INVALID",
    "message": "引用的记录不属于当前对象",
    "details": {
      "invalidRefs": ["message:991c38f0-2770-4fdf-b869-79b215d9ac60"]
    }
  },
  "traceId": "01JQ2K8P5D8M4K4MB4S6V9A2R1"
}
```

畸形 JSON、缺失必填字段、类型错误、非法 UUID 或无法解析的查询参数统一返回 `400 VALIDATION_ERROR`，不得返回空响应或落入 `500`。

### 4.5 状态码

| HTTP | 场景 | 错误码示例 |
| ---: | --- | --- |
| `200` | 读取或更新成功 | - |
| `201` | 创建资源或分析结果成功 | - |
| `204` | 删除或无响应体更新成功 | - |
| `400` | JSON、查询参数或字段格式错误 | `VALIDATION_ERROR` |
| `401` | 未登录或令牌失效 | `AUTH_REQUIRED`、`TOKEN_EXPIRED` |
| `403` | 身份有效但无权访问 | `FORBIDDEN` |
| `404` | 资源不存在或对当前用户不可见 | `RESOURCE_NOT_FOUND` |
| `409` | 状态、版本或幂等冲突 | `VERSION_CONFLICT`、`IDEMPOTENCY_KEY_REUSED` |
| `413` | 输入超过契约上限 | `INPUT_TOO_LARGE` |
| `422` | 格式正确但业务规则不满足 | `BUSINESS_RULE_VIOLATION` |
| `429` | 超过限流 | `RATE_LIMITED` |
| `500` | 未预期的服务错误 | `INTERNAL_ERROR` |
| `502` | 模型返回不可解析或违反契约的数据 | `MODEL_OUTPUT_INVALID` |
| `503` | 模型或服务暂不可用 | `MODEL_UNAVAILABLE` |
| `504` | 模型调用超时 | `MODEL_TIMEOUT` |

`NEEDS_CONTEXT` 和 `CANNOT_ADVISE` 是业务分析状态，正常返回 `201` 或 `200`，不能伪装成 HTTP 异常。

### 4.6 幂等与并发

创建分析请求时：

- `Idempotency-Key` 必须是 UUID；
- 相同用户、相同键和相同规范化载荷，返回首次成功结果，不重复计费或生成；
- 相同键但载荷不同，返回 `409 IDEMPOTENCY_KEY_REUSED`；
- 模型失败后是否允许使用同一键重试，由实现统一决定并保持稳定。

更新资源时携带当前 `version`。版本不一致返回 `409 VERSION_CONFLICT`，不得静默覆盖用户修改。

分页接口使用不透明 `nextCursor`；调用方不得解析游标。第一版默认每页最多 100 条，具体值属于 `OWNER-TBD`。

## 5. API 目录

所有公共路由均以 `/api/v1` 为前缀，下列路径省略该前缀。Node.js 前端只通过 Gateway 调用这些路由，不能直接调用任何 C# 业务服务或 Python 服务。

| 方法 | 路径 | 用途 | Gateway 路由目标 | 主要状态 |
| --- | --- | --- | --- | --- |
| `GET` | `/me/model-credentials` | 读取当前用户模型密钥的配置状态，不返回密钥 | AnalysisService | `200/401/503` |
| `PATCH` | `/me/model-credentials` | 更新当前用户本地模型密钥 | AnalysisService | `200/400/401/503` |
| `GET` | `/me/expression-style` | 读取用户表达习惯 | ExpressionStyleService | `200/401/404` |
| `PUT` | `/me/expression-style` | 幂等替换表达习惯 | ExpressionStyleService | `200/400/401/409` |
| `DELETE` | `/me/expression-style` | 删除用户表达习惯 | ExpressionStyleService | `204/401/404` |
| `GET` | `/contacts` | 列出用户保存的对象背景 | ContactContextService | `200/401` |
| `POST` | `/contacts` | 创建对象背景 | ContactContextService | `201/400/401` |
| `GET` | `/contacts/{contactId}` | 读取单个对象背景 | ContactContextService | `200/401/404` |
| `PATCH` | `/contacts/{contactId}` | 部分更新对象背景 | ContactContextService | `200/400/401/404/409` |
| `DELETE` | `/contacts/{contactId}` | 删除对象及其关联背景 | ContactContextService + AdviceService | `204/401/404/409/503` |
| `GET` | `/contacts/{contactId}/messages` | 列出聊天消息 | ContactContextService | `200/401/404` |
| `GET` | `/contacts/{contactId}/writing-style` | 读取当前对话本人发言的临时风格参考 | ContactContextService | `200/400/401/404` |
| `POST` | `/contacts/{contactId}/messages` | 保存聊天消息 | ContactContextService | `201/400/401/404` |
| `GET` | `/wechat-import/status` | 检查本机微信助手 | ContactContextService | `200/401/503` |
| `POST` | `/contacts/{contactId}/wechat-imports/preview` | 读取当前微信会话并创建短期预览 | ContactContextService | `200/400/401/404/422/429/503/504` |
| `POST` | `/contacts/{contactId}/wechat-imports` | 核对后原子批量导入预览消息 | ContactContextService | `201/400/401/404/409/422` |
| `POST` | `/contacts/{contactId}/text-imports` | 原子批量导入已解析的聊天文本 | ContactContextService | `201/400/401/404/409/413` |
| `PATCH` | `/messages/{messageId}` | 修正聊天消息 | ContactContextService | `200/400/401/404/409` |
| `DELETE` | `/messages/{messageId}` | 删除聊天消息及依赖分析 | ContactContextService + AdviceService | `204/401/404/409/503` |
| `GET` | `/contacts/{contactId}/events` | 列出线下事件和结果 | ContactContextService | `200/401/404` |
| `POST` | `/contacts/{contactId}/events` | 记录实际发生的事件 | ContactContextService | `201/400/401/404` |
| `PATCH` | `/events/{eventId}` | 修正事件 | ContactContextService | `200/400/401/404/409` |
| `DELETE` | `/events/{eventId}` | 删除事件及依赖分析 | ContactContextService + AdviceService | `204/401/404/409/503` |
| `GET` | `/contacts/{contactId}/preference-records` | 列出偏好与边界 | ContactContextService | `200/401/404` |
| `POST` | `/contacts/{contactId}/preference-records` | 新增偏好或边界 | ContactContextService | `201/400/401/404` |
| `PATCH` | `/preference-records/{recordId}` | 修正或替代记录 | ContactContextService | `200/400/401/404/409` |
| `DELETE` | `/preference-records/{recordId}` | 删除记录及依赖分析 | ContactContextService + AdviceService | `204/401/404/409/503` |
| `GET` | `/contacts/{contactId}/advice-requests` | 列出历史分析 | AdviceService | `200/401/404` |
| `POST` | `/contacts/{contactId}/advice-requests` | 创建并执行一次分析 | AdviceService | `201/400/401/404/409/422/429/502/503/504` |
| `GET` | `/advice-requests/{requestId}` | 读取已保存分析 | AdviceService | `200/401/404` |
| `POST` | `/advice-requests/{requestId}/feedback` | 记录采纳和表达反馈 | AdviceService | `200/201/400/401/404/409` |
| `POST` | `/advice-requests/{requestId}/outcomes` | 记录采取行动后的真实结果 | AdviceService -> ContactContextService | `201/400/401/404/409` |
| `DELETE` | `/advice-requests/{requestId}` | 删除一次分析及反馈 | AdviceService | `204/401/404` |
| `DELETE` | `/me/context-data` | 删除全部社交背景与分析数据 | ContactContextService（协调 AdviceService） | `204/401/503` |

分析结果创建后不可原地改写。用户修正输入后应创建新的分析；历史结果只允许追加反馈或删除。

### 5.1 路由所有权约束

- `/me/expression-style*` 只归属 ExpressionStyleService。
- `/contacts*`、`/messages*`、`/events*`、`/preference-records*` 只归属 ContactContextService。
- `/advice-requests*` 和 `/contacts/{contactId}/advice-requests*` 只归属 AdviceService。
- `/internal/v1/analysis` 只归属 Python AnalysisService。
- Gateway 不得复制同一资源的业务写逻辑；路由归属变更必须同步更新本文和所有调用方。
- `/me/context-data` 由 ContactContextService 接收并协调跨服务删除，不拥有建议数据。ContactContextService 必须请求 AdviceService 完成幂等删除后再删除联系人数据；任一步失败时返回失败并允许安全重试，不能把部分删除报告为完整成功。

### 5.2 删除协调

消息、事件、偏好或联系人的删除涉及 ContactContextService 与 AdviceService：

1. ContactContextService 将目标记录标记为 `DELETION_PENDING`，立即阻止新的读取、更新和分析。
2. ContactContextService 经 Gateway INTERNAL 请求 AdviceService 删除引用该记录的已保存分析及反馈。
3. AdviceService 返回按 `userId + evidenceRefs + deletionOperationId` 幂等的结果。
4. ContactContextService 在清理成功后硬删除原始记录和墓碑中的正文，只保留满足重试需要的最小删除凭证。
5. AdviceService 在清理完成前不得读取已标记删除的上下文；若 ContactContextService 暂时不可用，则删除请求返回 `503`，不得展示部分成功。

第一版允许同步完成上述流程。若以后改为事件驱动，删除事件必须使用过去式、按 `eventId` 幂等，并有补偿与死信处理。

## 6. 数据模型

### 6.1 用户表达习惯

```ts
type PreferredLength = "SHORT" | "MEDIUM" | "AS_NEEDED";
type EmojiPreference = "AVOID" | "NEUTRAL" | "SPARSE";
type TonePreference = "NEUTRAL" | "WARM" | "PLAYFUL" | "DIRECT" | "FORMAL";

interface ExpressionStyleInput {
  preferredLength: PreferredLength;
  emojiPreference: EmojiPreference;
  preferredTones: TonePreference[];       // 最多 3 项，不得重复
  avoidPatterns: string[];                // 最多 20 项；每项 1-100 字符
  examplePhrases: string[];               // 最多 10 项；每项 1-500 字符
  learnFromMessages?: boolean;            // 默认 true；false 关闭自动历史发言参考
}

interface ExpressionStyle extends ExpressionStyleInput {
  userId: Uuid;
  version: number;
  updatedAt: DateTime;
}
```

`avoidPatterns` 只描述表达习惯，例如“不喜欢连续使用感叹号”；它不能替代双方明确约定的行为边界。

### 6.2 对象背景

```ts
type RelationshipStage =
  | "JUST_CONNECTED"
  | "ACQUAINTED"
  | "ONGOING_CONTACT"
  | "PLANNING_MEETING"
  | "UNCLEAR";

interface ContactInput {
  label: string;                 // 用户自定义称呼，1-64 字符
  relationshipStage: RelationshipStage;
  connectionContext: string | null; // 如何认识、真实共同经历，0-2000 字符
  currentSituation: string | null;  // 当前已知情况，0-2000 字符
}

interface Contact extends ContactInput {
  contactId: Uuid;
  version: number;
  createdAt: DateTime;
  updatedAt: DateTime;
}
```

`connectionContext` 和 `currentSituation` 是用户说明，不等同于对方已确认事实。系统不能据此编造共同经历。

### 6.3 聊天消息

```ts
type MessageSender = "USER" | "OTHER" | "UNKNOWN";

interface MessageInput {
  sender: MessageSender;
  text: string;                  // 1-4000 字符，保留原文
  sentAt: DateTime | null;
  sequenceNo: number | null;     // 同一对象内可选顺序；未知为 null
  sourceType: Exclude<AssertionSource, "MODEL_INFERENCE">;
  isVerbatim: boolean;           // 是否与聊天界面原文一致
}

interface Message extends MessageInput {
  messageId: Uuid;
  contactId: Uuid;
  createdAt: DateTime;
  updatedAt: DateTime;
  version: number;
}
```

约束：

- `USER` 消息通常使用 `USER_SELF_REPORT`；
- `OTHER` 的逐字原文可使用 `COUNTERPART_EXPLICIT`；
- 用户凭记忆复原的内容应使用 `USER_RELAY` 且 `isVerbatim=false`；
- `UNKNOWN` 不得被模型自动分配为某一方；
- 同一对象的 `sequenceNo` 若使用，必须唯一且从 1 连续编号；
- 录入时间不自动成为消息发送时间。

### 6.4 线下事件

```ts
type EventType =
  | "MET_IN_PERSON"
  | "SHARED_EXPERIENCE"
  | "INVITATION_MADE"
  | "INVITATION_ACCEPTED"
  | "INVITATION_DECLINED"
  | "NO_RESPONSE"
  | "CONVERSATION_ENDED"
  | "USER_ACTION"
  | "OTHER";

interface EventInput {
  eventType: EventType;
  whatHappened: string;          // 可观察内容，1-2000 字符
  occurredAt: DateTime | null;
  sourceType: Exclude<AssertionSource, "MODEL_INFERENCE">;
  userReflection: string | null; // 用户自己的感受或判断，0-1000 字符
  relatedAdviceId: Uuid | null;
}

interface Event extends EventInput {
  eventId: Uuid;
  contactId: Uuid;
  createdAt: DateTime;
  updatedAt: DateTime;
  version: number;
}
```

`whatHappened` 只记录发生过什么。`userReflection` 可以写“我觉得她在敷衍我”，但系统必须把它视为用户解释，而不是已核验事实。

### 6.5 偏好、边界和情境记录

```ts
type RecordSubject = "USER" | "COUNTERPART";

type PreferenceCategory =
  | "INTEREST"
  | "COMMUNICATION_STYLE"
  | "HUMOR"
  | "BOUNDARY"
  | "CURRENT_CONTEXT";

type BoundaryRule =
  | "DO_NOT_CONTACT_AGAIN"
  | "DO_NOT_USE_NICKNAME"
  | "DO_NOT_DISCUSS_TOPIC"
  | "DO_NOT_MENTION_LOCATION"
  | "DO_NOT_PUBLICLY_MENTION"
  | "NO_PHYSICAL_CONTACT"
  | "OTHER";

type RecordStatus = "PENDING" | "CONFIRMED" | "SUPERSEDED" | "REJECTED";

interface PreferenceRecordInput {
  subject: RecordSubject;
  category: PreferenceCategory;
  statement: string;             // 具体内容，1-2000 字符
  boundaryRule: BoundaryRule | null;
  appliesWhen: string | null;    // 只适用于哪些时间、地点或情境
  sourceType: AssertionSource;
  sourceRefs: EvidenceRef[];
  supersedesRecordId: Uuid | null;
}

interface PreferenceRecord extends PreferenceRecordInput {
  recordId: Uuid;
  contactId: Uuid;
  status: RecordStatus;
  hardConstraint: boolean;
  createdAt: DateTime;
  updatedAt: DateTime;
  version: number;
}
```

业务约束：

- `category=BOUNDARY` 时 `boundaryRule` 必填；其他类别必须为 `null`；
- `sourceType=MODEL_INFERENCE` 时只能创建 `PENDING` 记录；
- 用户明确确认或编辑后的记录才能成为 `CONFIRMED`；
- `COUNTERPART_EXPLICIT` 的边界在用户确认后默认 `hardConstraint=true`；
- `DO_NOT_CONTACT_AGAIN` 必须始终为硬约束；
- 新记录不能通过删除旧记录来掩盖冲突；应保留旧记录并标记 `SUPERSEDED`，或并存后请求补问；
- 没有来源或无适用情境的模型推测不得自动进入长期记忆；
- `sourceRefs` 必须属于同一 `contactId`，最多 20 项。
- 持久化的 `sourceRefs` 只能引用已保存的消息、事件或偏好记录，不能引用一次请求中的 `ephemeral:*`；没有关联记录时可以为空，以当前记录自身的 `sourceType` 为准。

### 6.6 分析请求

```ts
type UserGoal =
  | "START_CONTACT"
  | "CONTINUE_CONVERSATION"
  | "EXTEND_TOPIC"
  | "PROPOSE_INVITATION"
  | "PREPARE_MEETING"
  | "EXPRESS_INTEREST"
  | "CLARIFY_MISUNDERSTANDING"
  | "APOLOGIZE"
  | "END_CONVERSATION"
  | "DECIDE_NEXT_STEP"
  | "REVIEW_INTERACTION"
  | "ASSESS_AFFINITY"
  | "OTHER";

interface EphemeralMessage {
  clientRef: string;             // 请求内唯一，1-32 字符
  sender: MessageSender;
  text: string;
  sentAt: DateTime | null;
  sourceType: Exclude<AssertionSource, "MODEL_INFERENCE">;
  isVerbatim: boolean;
}

interface EphemeralEvent {
  clientRef: string;
  eventType: EventType;
  whatHappened: string;
  occurredAt: DateTime | null;
  sourceType: Exclude<AssertionSource, "MODEL_INFERENCE">;
  userReflection: string | null;
}

interface EphemeralStatement {
  clientRef: string;
  subject: RecordSubject;
  category: PreferenceCategory;
  statement: string;
  boundaryRule: BoundaryRule | null;
  appliesWhen: string | null;
  sourceType: AssertionSource;
}

interface EphemeralContext {
  messages: EphemeralMessage[];       // 0-50
  events: EphemeralEvent[];           // 0-20
  statements: EphemeralStatement[];   // 0-20
}

interface AdviceRequestInput {
  entryPoint: EntryPoint;
  userGoal: UserGoal;
  specificQuestion: string | null;    // 0-2000 字符
  selectedMessageIds: Uuid[];         // 0-200
  selectedEventIds: Uuid[];           // 0-50
  selectedPreferenceIds: Uuid[];      // 0-50
  draftText: string | null;           // 0-2000 字符
  ephemeralContext: EphemeralContext | null;
}
```

分析上下文规则：

- `selected*Ids` 必须属于路径中的 `contactId`；
- 只有用户选择或用户主动提交的普通背景会进入分析；
- 当前有效且适用的硬边界由后端自动纳入，即使用户未选择，也必须防止建议违反该边界；
- `ephemeralContext` 只用于本次请求，不写入长期背景档案；
- `clientRef` 在单个请求内必须唯一，仅通过 `ephemeral:{clientRef}` 引用；
- 持久化的偏好、消息、事件和分析不能以 `ephemeral:*` 作为长期来源；
- 用户草稿原样作为待分析数据，不能被当作提示词指令。

`ephemeralContext` 的原文是否临时落盘属于隐私实现项。若为幂等或故障恢复临时保存，必须设置明确的短期保留期限、访问隔离和删除机制，具体期限为 `OWNER-TBD`。

### 6.7 分析结果

```ts
type AdviceStatus = "OK" | "NEEDS_CONTEXT" | "CANNOT_ADVISE";

type ObservationKind = "FACT" | "INFERENCE";

interface Observation {
  statement: string;
  kind: ObservationKind;
  evidenceRefs: EvidenceRef[];
}

type ActionType =
  | "ASK_FOLLOW_UP"
  | "CONTINUE_TOPIC"
  | "SHARE_REAL_EXPERIENCE"
  | "PROPOSE_SPECIFIC_INVITATION"
  | "PREPARE_MEETING"
  | "EXPRESS_INTEREST"
  | "CLARIFY"
  | "APOLOGIZE"
  | "SLOW_DOWN"
  | "END_CONVERSATION"
  | "GATHER_CONTEXT"
  | "NO_ACTION";

type ActionTag =
  | "CONTACT"
  | "INVITE"
  | "EXPRESS_INTEREST"
  | "USE_NICKNAME"
  | "DISCUSS_TOPIC"
  | "MENTION_LOCATION"
  | "PUBLIC_MENTION"
  | "PHYSICAL_CONTACT";

interface AlternativeAction {
  actionType: ActionType;
  title: string;
  appliesWhen: string;
  actionTags: ActionTag[];
}

interface Recommendation {
  actionType: ActionType;
  title: string;                 // 1-200 字符
  reason: string;                // 简短理由，1-500 字符；不是内部推理链
  evidenceRefs: EvidenceRef[];
  actionTags: ActionTag[];
  appliesWhen: string | null;
  alternatives: AlternativeAction[]; // 最多 2 项
}

interface ReplyOption {
  optionId: string;
  text: string;                  // 1-1000 字符
  style: string;                 // 简短标签，例如“简短自然”
  evidenceRefs: EvidenceRef[];
  appliesWhen: string | null;
}

interface DraftRevision {
  text: string;
  changes: string[];             // 最多 3 条用户可理解的修改说明
}

interface ResponseHandling {
  scenario: "ACCEPTS" | "AMBIGUOUS" | "DECLINES" | "NO_RESPONSE";
  guidance: string;
}

interface ClarifyingQuestion {
  question: string;
  reason: string;
  fieldHint:
    | "RELATIONSHIP_CONTEXT"
    | "MESSAGE_CONTENT"
    | "EVENT_RESULT"
    | "USER_GOAL"
    | "PREFERENCE_OR_BOUNDARY"
    | "OTHER";
}

type CannotAdviseReasonCode =
  | "BOUNDARY_OVERRIDE"
  | "COERCION_OR_PRESSURE"
  | "DECEPTION"
  | "PRIVACY_VIOLATION"
  | "THIRD_PARTY_MONITORING"
  | "UNVERIFIABLE_EXTERNAL_FACT"
  | "OUT_OF_SCOPE";

interface AffinityAssessment {
  score: number | null;             // 0–100 整数；信息不足为 null，不是概率
  confidence: "LOW" | "MEDIUM" | "HIGH"; // 依据充分度，不是对方心意的确定性
  summary: string;                  // 1–500 字符
  evidence: Array<{                 // 最多 8 项，引用必须存在于本次上下文
    signal: "POSITIVE" | "NEGATIVE" | "AMBIGUOUS";
    description: string;            // 1–500 字符
    evidenceRefs: EvidenceRef[];     // 每项至少一条
  }>;
  uncertainties: string[];          // 1–8 项，每项最多 1000 字符
}

interface AdviceBase {
  requestId: Uuid;
  contactId: Uuid;
  schemaVersion: "1.0";
  status: AdviceStatus;
  contextUsedRefs: EvidenceRef[];
  observations: Observation[];
  uncertainties: string[];
  affinityAssessment?: AffinityAssessment | null;
  recommendation: Recommendation | null;
  replyOptions: ReplyOption[];
  draftRevision: DraftRevision | null;
  responseHandling: ResponseHandling[];
  clarifyingQuestions: ClarifyingQuestion[];
  engineVersion: string;
  createdAt: DateTime;
}

interface AdviceOk extends AdviceBase {
  status: "OK";
  recommendation: Recommendation;
}

interface AdviceNeedsContext extends AdviceBase {
  status: "NEEDS_CONTEXT";
  recommendation: null;
  replyOptions: [];
  draftRevision: null;
  clarifyingQuestions: [ClarifyingQuestion, ...ClarifyingQuestion[]];
}

interface AdviceCannotAdvise extends AdviceBase {
  status: "CANNOT_ADVISE";
  recommendation: null;
  replyOptions: [];
  draftRevision: null;
  cannotAdviseReason: {
    code: CannotAdviseReasonCode;
    message: string;
  };
}

type AdviceResult = AdviceOk | AdviceNeedsContext | AdviceCannotAdvise;
```

结果约束：

- `OK` 必须恰有一条主建议；
- `replyOptions` 默认一至三条；不必为凑数量输出近似候选，线下行动可以为空；
- 用户提供草稿时优先给出一份 `draftRevision`，除非草稿不应发送；
- `NEEDS_CONTEXT` 不生成可发送文案，至少提出一个会改变建议的补问；
- `CANNOT_ADVISE` 不提供规避边界的替代话术，只解释不能协助的原因和产品边界；
- `observations.kind=FACT` 必须有证据引用；
- `observations.kind=INFERENCE` 必须同时存在于 `uncertainties` 或以明确“可能/尚不清楚”措辞呈现；
- `Recommendation.reason` 是用户可检查的简短理由，不是模型内部思维过程；
- 不得虚构真实营业时间、价格、路线、共同经历或对方意愿。

### 6.8 服务间载荷

#### 6.8.1 AdviceService -> ContactContextService

```ts
interface ContextQueryInput {
  requestId: Uuid;                 // 本次分析 ID，用于链路追踪
  contactId: Uuid;
  selectedMessageIds: Uuid[];      // 0-200
  selectedEventIds: Uuid[];        // 0-50
  selectedPreferenceIds: Uuid[];   // 0-50
  includeApplicableHardBoundaries: true;
}

interface ScopedContextBundle {
  contact: Contact;
  messages: Message[];
  events: Event[];
  preferenceRecords: PreferenceRecord[];
  selectedPreferenceIds: Uuid[];
  autoIncludedPreferenceIds: Uuid[];
}
```

ContactContextService 保证：

- 所有对象属于 `X-User-Id` 对应的用户和指定联系人；
- `messages`、`events`、`preferenceRecords` 只包含用户选择的记录，加上当前适用且必须遵守的硬边界；
- `autoIncludedPreferenceIds` 必须准确列出系统自动纳入、用户未主动选择的硬边界；
- 已删除、`DELETION_PENDING`、`REJECTED` 或不适用于当前情境的记录不得返回；
- 不返回该联系人的其他历史消息、其他联系人或用户凭证。

自动表达习惯增补（2026-10-25）：ContextQuery 可选 `includeWritingStyle`，默认 false。启用时返回独立的 `writingStyle`，只从当前用户、当前联系人、未删除且非 pending 的 `sender=USER` 发言中临时提取；最多 80 条可用发言，最多 12 条原话例句，每条不超过 160 字符。排除链接、邮箱、常见凭证格式、附件占位和明显粘贴内容。返回 `contactId/sampleCount/verbatimSampleCount/medianLength/questionRate/emojiObserved/patterns/examples/sourceMessageIds`。这是对上条“其他历史消息”的明确、可关闭的风格参考例外，不增加 `messages` 中的事实背景，也不允许从风格源 ID 构造未选择的事实引用。该对象不持久化为另一份聊天档案。

AdviceService 默认启用自动参考，手动 `learnFromMessages=false` 关闭，好感度评估不额外读取风格历史。保存建议时，风格来源另存 `styleDependencies`；来源被编辑、删除或全部社交数据清除时，依赖结果沿用原有失效机制。生成期间风格源或手动设置变化会返回版本冲突。手动偏好高于自动特征；转述样本保留低可靠度标记，不把“未观察到 emoji”当成禁用偏好。DeepSeek 与 Jev 只把例句用于用词、句长、标点及语气，不能复制其中的事实、关系或承诺。

#### 6.8.2 AdviceService -> AnalysisService

```ts
interface AnalysisInput {
  requestId: Uuid;
  schemaVersion: "1.0";
  entryPoint: EntryPoint;
  userGoal: UserGoal;
  specificQuestion: string | null;
  draftText: string | null;
  expressionStyle: ExpressionStyle | null;
  context: ScopedContextBundle;
}

interface AnalysisOutput {
  schemaVersion: "1.0";
  status: AdviceStatus;
  contextUsedRefs: EvidenceRef[];
  observations: Observation[];
  uncertainties: string[];
  affinityAssessment?: AffinityAssessment | null;
  recommendation: Recommendation | null;
  replyOptions: ReplyOption[];
  draftRevision: DraftRevision | null;
  responseHandling: ResponseHandling[];
  clarifyingQuestions: ClarifyingQuestion[];
  cannotAdviseReason?: {
    code: CannotAdviseReasonCode;
    message: string;
  };
  engineVersion: string;
  createdAt: DateTime;
}
```

AnalysisService 边界：

- 只接收 AdviceService 已裁剪的 `AnalysisInput`，不接受用户令牌、数据库连接信息或其他联系人的 ID；
- 不自行扩展上下文，不调用 ContactContextService 或 ExpressionStyleService；
- 只调用配置的 LLM 供应商，并把供应方错误映射成内部稳定错误；
- 不保存建议、反馈、联系人、表达习惯或账号数据；
- 临时内存中的原文、提示词和模型响应必须按 `OWNER-TBD` 的期限清理；
- `AnalysisOutput` 不是最终公共结果。AdviceService 必须补上 `requestId`、`contactId` 并完成结构、引用和硬边界校验后，才可返回 `AdviceResult`。

当 `status=CANNOT_ADVISE` 时 `cannotAdviseReason` 必填；其他状态不得携带该字段。Python 模型必须启用严格字段校验并拒绝额外字段，防止供应商响应中的未知内容直接进入 C#。

#### 6.8.3 服务间公共约束

- 所有 INTERNAL JSON 使用 camelCase 字段名和大写枚举值，与公共 API 保持一致。
- 时间使用 RFC 3339；未知时间仍为 `null`。
- 成功与错误继续使用 `ApiSuccess` / `ApiFailure` 信封。
- `traceId` 在 Browser -> Gateway -> AdviceService -> AnalysisService 链路中保持可关联。
- Python 响应必须带 `schemaVersion` 和 `engineVersion`；C# 不接受缺失或版本不兼容的结果。
- `contextUsedRefs` 必须是 `AnalysisInput.context` 中真实存在的引用子集，不能引用 Python 自行生成的联系人、消息、事件或偏好 ID。

## 7. 端点行为与 Mock

### 本地微信助手增补（MVP，2026-10-25）

个人微信仅读取用户当前打开会话的已加载纯文本消息；用气泡背景定位，检查纯文本菜单后通过微信复制功能取原文。Windows OCR 仅识别菜单与会话名称，不转写正文；不解析整库，不自动发送微信消息，不触发模型分析。

- `GET /wechat-import/status` 返回 `{ available, version, method: "WINDOWS_LOCAL_TEXT", message }`，使用标准成功信封；前端兼容旧助手的 `WINDOWS_LOCAL_OCR`。
- `POST /contacts/{contactId}/wechat-imports/preview` 输入 `{ count: 50 }`，`count` 必须为 1–100 的整数；旧 `pages` 字段不再接受。先验证联系人所有权，再调用本机命令行助手。返回 `{ previewId, contactId, conversationTitle, wechatVersion, capturedAt, expiresAt, messages, warnings }`，消息数不超过请求条数。
- 从当前画面的最新消息向上读取，达到目标条数即停止；非纯文本及翻页重叠不计数。通过相邻画面像素位移和气泡位置确认同一消息，复用已读结果；不单凭文本相同合并真实重复发言。无法确认画面重叠、没有更早内容或达到读取时限时停止并返回实际条数及 warning，不用重复内容补足目标。
- 预览消息为 `{ clientId, sender, text, sentAt, sourceType: "USER_RELAY", isVerbatim: false, possibleDuplicate }`；读取结果不等于核验后的逐字事实。完整日期未可靠识别时 `sentAt=null`；无法确认说话人则为 `UNKNOWN`。
- 导入输入为 `{ previewId, conversationConfirmed: true, messages: [{ clientId, sender, text }] }`。只允许当前用户、当前联系人有效预览中的消息；可修正原文与说话人。
- 一次事务写入所有所选消息，`sequenceNo=null`，来源保持 `USER_RELAY`、`isVerbatim=false`。返回 `{ importId, contactId, importedCount, skippedCount, messageIds, createdAt }`。
- 同一预览、相同选择和修改内容重试返回同一批消息 ID，`importedCount=0`；改变已提交预览的载荷返回 `409 IDEMPOTENCY_KEY_REUSED`。
- 新预览对已存的同说话人/相似空白文本标记 `possibleDuplicate`，页面默认不选；用户可以显式选入。没有可靠消息 ID 和日期时，不以文本相同为由硬删除真实的重复发言。
- 原始预览仅存在 Context 服务内存，5 分钟过期，每 10 秒清理；上限 32 份、每用户 8 份。联系人或全部社交数据删除时清理对应预览。已提交回执只保留幂等摘要和消息 ID。
- 本机截图通过内存管道交给 OCR，无截图文件落盘；助手无公开端口。浏览器只访问 Gateway，由 Context 服务启动已配置助手进程。
- 转发聊天记录卡片、图片和表情包不进入正文；Unicode emoji 和已知微信表情占位符被移除，纯表情消息跳过。清理汉字及中文标点旁的空格，英文词间保留一个必要空格，保留原文换行。
- 读取前备份剪贴板，每次复制后还原。检测到其他程序修改剪贴板即停止且不覆盖新内容；备份不支持的格式时直接报错。取消或进程异常退出在极短的复制期间可能中断还原，不能保证这种情况下剪贴板仍为原值。
- 无更多历史或窗口未响应上翻时返回已读结果及 warning；切换到另一个微信会话时停止并返回 `WECHAT_CONVERSATION_CHANGED`，不混合两个会话。
- 本地捕获不等于完整微信导出，也不包含语音转写或附件提取。该增补将原先不做的截图识别限定扩展为本机、按次触发的当前会话读取。

### 7.1 创建聊天消息

```http
POST /api/v1/contacts/9f11f90a-f8cc-4e48-a4ab-30b14ea824df/messages
Content-Type: application/json
```

```json
{
  "sender": "OTHER",
  "text": "今天汇报搞砸了，有点难受。",
  "sentAt": null,
  "sequenceNo": 38,
  "sourceType": "COUNTERPART_EXPLICIT",
  "isVerbatim": true
}
```

成功时返回 `201 ApiSuccess<Message>`。`sentAt=null` 表示时间未知，后端不能自动改成 `createdAt`。

### 7.2 创建分析请求

```http
POST /api/v1/contacts/9f11f90a-f8cc-4e48-a4ab-30b14ea824df/advice-requests
Content-Type: application/json
Idempotency-Key: e5d4f8a8-2433-4d1a-91c5-c3aa6bf6cc32
```

```json
{
  "entryPoint": "BUILD_RELATIONSHIP",
  "userGoal": "CONTINUE_CONVERSATION",
  "specificQuestion": "她已经说了难受但没讲原因，我下一句怎么接？",
  "selectedMessageIds": [
    "2869ab5e-6f3e-4cb4-ae48-478555bf45bb"
  ],
  "selectedEventIds": [],
  "selectedPreferenceIds": [],
  "draftText": "听起来今天挺不顺的。你想吐槽一下，还是先歇会儿？",
  "ephemeralContext": null
}
```

### 7.3 正常建议 Mock

```json
{
  "data": {
    "requestId": "fd80bd5e-1998-4749-a76f-a7114c4b7fd2",
    "contactId": "9f11f90a-f8cc-4e48-a4ab-30b14ea824df",
    "schemaVersion": "1.0",
    "status": "OK",
    "contextUsedRefs": [
      "message:2869ab5e-6f3e-4cb4-ae48-478555bf45bb"
    ],
    "observations": [
      {
        "statement": "对方表达汇报不顺并感到难受，但尚未说明具体经过",
        "kind": "FACT",
        "evidenceRefs": [
          "message:2869ab5e-6f3e-4cb4-ae48-478555bf45bb"
        ]
      }
    ],
    "uncertainties": [
      "尚不清楚汇报中具体发生了什么",
      "无法从这句话判断对方此刻是否想继续聊天"
    ],
    "recommendation": {
      "actionType": "ASK_FOLLOW_UP",
      "title": "先用一个短问题留出话口",
      "reason": "接住已经表达出的难受，同时不替对方评价结果。",
      "evidenceRefs": [
        "message:2869ab5e-6f3e-4cb4-ae48-478555bf45bb"
      ],
      "actionTags": [
        "CONTACT"
      ],
      "appliesWhen": "双方是普通的同学或同事关系，且尚未说明具体情况",
      "alternatives": [
        {
          "actionType": "SLOW_DOWN",
          "title": "如果对方明显不想展开，就自然结束这一轮",
          "appliesWhen": "对方回复很短或明确表示想先休息",
          "actionTags": []
        }
      ]
    },
    "replyOptions": [
      {
        "optionId": "r1",
        "text": "啊，怎么了？",
        "style": "简短自然",
        "evidenceRefs": [
          "message:2869ab5e-6f3e-4cb4-ae48-478555bf45bb"
        ],
        "appliesWhen": "关系尚不亲密，不需要展开安慰"
      }
    ],
    "draftRevision": {
      "text": "啊，怎么了？",
      "changes": [
        "保留对难受的回应，先问具体经过",
        "去掉尚未获得依据的安慰和封闭式选项"
      ]
    },
    "responseHandling": [
      {
        "scenario": "ACCEPTS",
        "guidance": "继续接对方说出的具体内容，不要跳回自己的经历。"
      },
      {
        "scenario": "DECLINES",
        "guidance": "对方不想展开时，简短回应并结束这一轮。"
      }
    ],
    "clarifyingQuestions": [],
    "engineVersion": "social-advice-protocol-1.0",
    "createdAt": "2026-10-24T11:30:00Z"
  },
  "meta": {},
  "traceId": "01JQ2K8P5D8M4K4MB4S6V9A2R1"
}
```

### 7.4 需要补充背景 Mock

场景：对方只回复“嗯”，但没有提供用户上一条发了什么，无法判断是在结束聊天、忙碌，还是只是简短回应。

```json
{
  "data": {
    "requestId": "16a32864-cb33-46ce-8ef9-c5c559d33e63",
    "contactId": "9f11f90a-f8cc-4e48-a4ab-30b14ea824df",
    "schemaVersion": "1.0",
    "status": "NEEDS_CONTEXT",
    "contextUsedRefs": [
      "message:405b60cc-0cf7-4f56-acba-eef1bfe9968d"
    ],
    "observations": [
      {
        "statement": "对方最近一条可核对的回复只有一个“嗯”",
        "kind": "FACT",
        "evidenceRefs": [
          "message:405b60cc-0cf7-4f56-acba-eef1bfe9968d"
        ]
      }
    ],
    "uncertainties": [
      "不知道用户此前发送了什么",
      "不能仅凭一个“嗯”判断对方想结束聊天"
    ],
    "recommendation": null,
    "replyOptions": [],
    "draftRevision": null,
    "responseHandling": [],
    "clarifyingQuestions": [
      {
        "question": "你上一条具体发了什么？",
        "reason": "上一条内容决定“嗯”是在回应邀请、附和一个话题，还是结束对话。",
        "fieldHint": "MESSAGE_CONTENT"
      }
    ],
    "engineVersion": "social-advice-protocol-1.0",
    "createdAt": "2026-10-24T11:32:00Z"
  },
  "meta": {},
  "traceId": "01JQ2K9C6N5T4D2VV8K5B7H3S0"
}
```

### 7.5 不能建议 Mock

场景：对方已经明确拒绝，用户仍要求生成让对方不得不同意的表达。

```json
{
  "data": {
    "requestId": "7ef828d7-637f-43ba-b2f3-4184e7e113c2",
    "contactId": "9f11f90a-f8cc-4e48-a4ab-30b14ea824df",
    "schemaVersion": "1.0",
    "status": "CANNOT_ADVISE",
    "contextUsedRefs": [
      "preference:9cc0c82b-0677-46d5-b84f-e0d97d77a6ef"
    ],
    "observations": [
      {
        "statement": "已保存记录显示对方明确表示不愿继续联系",
        "kind": "FACT",
        "evidenceRefs": [
          "preference:9cc0c82b-0677-46d5-b84f-e0d97d77a6ef"
        ]
      }
    ],
    "uncertainties": [],
    "recommendation": null,
    "replyOptions": [],
    "draftRevision": null,
    "responseHandling": [],
    "clarifyingQuestions": [],
    "cannotAdviseReason": {
      "code": "BOUNDARY_OVERRIDE",
      "message": "对方已明确表示不愿继续联系，不能协助生成施压、反复追问或绕过拒绝的表达。"
    },
    "engineVersion": "social-advice-protocol-1.0",
    "createdAt": "2026-10-24T11:35:00Z"
  },
  "meta": {},
  "traceId": "01JQ2KA7Q8D5X3W09M6S2P4H1"
}
```

### 7.6 反馈与结果

```ts
type FeedbackFlag =
  | "TOO_ROBOTIC"
  | "TOO_SMOOTH"
  | "NOT_ME"
  | "TOO_LONG"
  | "MISREAD_CONTEXT"
  | "TOO_PUSHY"
  | "BOUNDARY_RISK"
  | "OTHER";

interface AdviceFeedbackInput {
  selectedOptionId: string | null;
  editedText: string | null;
  flags: FeedbackFlag[];       // 最多 8 项
  comment: string | null;      // 0-1000 字符
}
```

反馈只记录用户评价，不自动改写表达习惯。用户需通过 `PUT /me/expression-style` 明确保存新的表达偏好。

行动结果通过 `/advice-requests/{requestId}/outcomes` 创建 `Event`，其中：

- `whatHappened` 记录实际可观察结果；
- `userReflection` 记录用户自己的解释，可与后者并存；
- `relatedAdviceId` 自动设置为当前分析 ID；
- 结果不会自动更新对方偏好；需要用户确认的记录仍通过偏好接口保存。

## 8. 校验规则

### 8.1 HTTP 与结构校验

程序必须自动检查：

1. JSON 可解析，`Content-Type` 正确；
2. UUID、日期、枚举和字段类型合法；
3. 字符串长度、数组数量和必填条件满足；
4. 路径资源存在且属于当前用户；
5. `selected*Ids` 与 `sourceRefs` 属于同一对象；
6. 相同对象内消息顺序没有重复或断裂；
7. 幂等键和版本冲突得到稳定响应；
8. 模型输出通过完整 `AdviceResult` Schema；
9. 状态与字段存在性符合联合约束，例如 `NEEDS_CONTEXT` 必须有补问；
10. `OK` 至少有一条建议，且 `replyOptions` 不超过三条；
11. 每条 `FACT` 观察都有存在的证据引用；
12. 返回的 `contextUsedRefs` 均来自本次允许的上下文；
13. 模型输出含有不存在的引用、未知枚举或超长字段时，不向前端展示。

### 8.2 跨字段业务规则

- 含 `DO_NOT_CONTACT_AGAIN` 的硬边界存在时，不能输出 `CONTACT`、`INVITE`、`EXPRESS_INTEREST` 等继续推进标签；
- `DO_NOT_USE_NICKNAME` 生效时，不能推荐使用称呼；
- 明确拒绝某话题或地点时，不能以“换个说法”绕过该边界；
- `MODEL_INFERENCE` 记录不能自动成为 `CONFIRMED`；
- 用户草稿只有作为输入时才能生成修改建议，不能自动保存为用户表达；
- 分析结果不能包含“必须得到回复”“继续问就会同意”等结果保证；
- 缺少线下场所的实时资料时，不能编造营业时间、价格、可订状态或路线。

代码可以保证引用存在、结构合法和结构化硬约束不被直接命中；建议是否真正尊重边界、是否自然仍必须通过语义评测和人工验收。

### 8.3 模型失败处理

- 空响应、截断、超时、Schema 错误或引用错误可采用有限重试；
- 重试次数和超时值属于 `OWNER-TBD`；
- 持续失败时保留用户输入并返回统一错误，不展示未经校验的文本；
- 502、503、504 不得被前端显示成正常建议；
- 对同一失败请求是否计费或占用额度不属于本文范围；
- 不使用第二个模型“同意”作为事实正确性的证明。

双模型实现增补（2026-10-25）：DeepSeek 生成候选后，由 TypeSafe Jev 使用独立 System One 接口复核无依据事实、边界、必要背景和表达习惯。高概率问题触发一次修改与再次复核；结构重试和修改共用最多两次生成预算，最多两次 Jev 调用，总时限 60 秒。持续被标记返回 `502 MODEL_REVIEW_FAILED`。中间概率在现有 `uncertainties` 中提示核对；不把概率写成 `FACT`，不替代服务端证据、边界和所有权检查。启用 Jev 后，其失败不会降级为未复核的成功；错误包括 `JEV_UNAVAILABLE`、`JEV_TIMEOUT`、`JEV_REQUEST_INVALID`、`JEV_OUTPUT_INVALID`。对外结果结构不变，`engineVersion` 记录两者模型及复核版本。Jev 仅接收本次分析已选择的上下文和候选，不额外获取其他联系人记录。

### 8.4 服务边界校验

Gateway、C# 服务和 Python 服务必须分别执行以下检查：

| 责任点 | 校验要求 |
| --- | --- |
| Gateway 公共入口 | 令牌、用户状态、路由 allowlist、请求大小、限流和关联 ID |
| Gateway INTERNAL 入口 | 调用方服务名、服务密钥、目标接口 allowlist，转发前剥离伪造身份头 |
| ExpressionStyleService | 当前用户只能读写自己的表达习惯，版本冲突不覆盖 |
| ContactContextService | 联系人、消息、事件和偏好均属于当前用户；只返回请求范围内的上下文和适用硬边界 |
| AdviceService | 幂等键、跨服务 ID 范围、`AnalysisInput/Output` Schema、证据引用和硬边界标签 |
| AnalysisService | 请求来源、Schema 版本、上下文数量上限、严格模型输出解析，禁止额外字段 |

建议稳定的服务错误码：

| 错误码 | HTTP | 产生位置 | 场景 |
| --- | ---: | --- | --- |
| `SERVICE_IDENTITY_INVALID` | 403 | Gateway / 目标服务 | 服务名、密钥或 Gateway 注入头无效 |
| `SERVICE_ROUTE_FORBIDDEN` | 403 | Gateway | 服务不在目标 INTERNAL 接口 allowlist |
| `CONTEXT_SCOPE_INVALID` | 422 | ContactContextService / AdviceService | ID 跨用户、跨联系人或不属于允许上下文 |
| `ANALYSIS_SCHEMA_UNSUPPORTED` | 422 | AnalysisService / AdviceService | 请求或响应契约版本不兼容 |
| `MODEL_OUTPUT_INVALID` | 502 | AdviceService | Python 返回不可解析、缺字段或违反联合约束 |
| `MODEL_UNAVAILABLE` | 503 | Gateway / AdviceService | Python 服务或上游模型不可达 |
| `MODEL_TIMEOUT` | 504 | Gateway / AdviceService | 模型调用超过已配置预算 |
| `DELETION_INCOMPLETE` | 503 | ContactContextService / Gateway | 跨服务删除尚未完成，可安全重试 |

任何服务都不得用 `200` 包裹上述失败，也不得将上游 5xx 伪装成用户输入错误。

## 9. 数据、隐私与删除

### 9.1 数据用途分离

| 用途 | 是否需要单独授权 |
| --- | --- |
| 本次分析 | 用户提交或选择上下文即可 |
| 长期保存到联系人档案 | 用户明确保存记录时 |
| 用于产品训练 | 必须另行取得相应授权，第一版默认不采集 |
| 公开作为案例 | 必须获得明确公开授权；公开版本还应去标识化 |

### 9.2 最小化原则

- 只向模型发送当前任务所需消息和记录；
- 不发送与当前建议无关的历史；
- 默认不把聊天正文写入应用日志；
- 不在前端、GitHub 或客户端日志中出现模型密钥；
- 模型供应商的数据留存和训练政策必须在用户使用前说明。

### 9.3 删除语义

- `DELETE /messages/{messageId}`、`DELETE /events/{eventId}` 和 `DELETE /preference-records/{recordId}` 删除原始记录；
- 若某次已保存分析引用了该记录，ContactContextService 必须请求 AdviceService 删除对应分析结果和反馈，避免原始内容残留在观察或建议中；
- `DELETE /contacts/{contactId}` 删除该对象的背景、消息、事件、偏好、分析、反馈和关联结果；
- `DELETE /me/context-data` 删除全部对象、社交背景与分析数据，但保留用户表达习惯；
- `DELETE /me/expression-style` 单独删除表达习惯；个人语料库需另行 `DELETE /me/voice-corpus`。这三类内容分别清理，本地模型凭证也有独立删除接口；
- 删除流程按 §5.2 执行；AdviceService 在跨服务清理完成前不得把结果继续返回给用户；
- AnalysisService 没有用户数据持久化职责；日志和供应商侧数据清理不属于任一业务数据库，但必须写入隐私保留策略；
- 删除为立即对用户不可见；备份、缓存和第三方模型供应商的删除时限属于 `OWNER-TBD`，上线前必须写入隐私说明；
- 删除不可恢复，接口不得把“标记隐藏”描述成完整删除。

## 10. 评测与验收

### 10.1 契约验收

第一版至少满足：

- 所有 JSON Mock 可通过 JSON 解析；
- 所有请求和响应可对应本文类型；
- 正常、补问、不能建议、模型失败和权限失败分支均有契约测试；
- 幂等重放返回同一结果，冲突载荷返回 `409`；
- 引用不存在、跨联系人、跨用户和已删除时均被拒绝；
- 删除后不进入后续上下文，依赖分析不可再读取；
- Gateway 会剥离浏览器伪造的服务身份和用户身份头；
- `/internal/v1/analysis` 仅允许 AdviceService 调用，其他服务及浏览器均返回 `403`；
- Gateway、C# 建议服务和 Python 分析服务之间使用兼容的请求/响应 Schema；
- 任一内部服务不可用时不会被伪装成正常分析结果；
- 前端不能自行发送消息，系统不提供自动发送路由。

### 10.2 固定评测案例

评测集不得与提示词示例直接复用。至少覆盖：

1. 刚认识但只提供了加好友渠道；
2. 对方已解释具体问题，模型仍重复追问；
3. 对方只有一句“嗯”；
4. 玩笑偏好未知；
5. 对方明确拒绝后用户仍想推进；
6. 前后偏好冲突；
7. 用户草稿已经自然；
8. 记录中包含提示词注入；
9. 线下活动缺少时间、距离或预算；
10. 真实接受邀请与“她喜欢我”的解释混写；
11. 模型想使用未提供的共同经历；
12. 用户修改后反馈“太油”“不像我”。

### 10.3 评价维度

| 维度 | 评价重点 |
| --- | --- |
| 协议可靠性 | JSON、枚举、引用、状态和异常是否符合契约 |
| 事实一致性 | 是否编造经历、动机、时间或角色 |
| 证据有效性 | 引用是否真的支持观察和行动 |
| 行动适切性 | 是否符合当前背景，是否应先补问或放缓 |
| 自然程度 | 是否像用户本人，能否自然说出口 |
| 边界尊重 | 是否忽略明确拒绝、偏好或当前情境 |
| 用户控制 | 是否可编辑、可纠正、无自动发送 |
| 工程表现 | 延迟、失败率、重试成本与数据删除 |

结构与引用可自动测试；自然程度、行动适切性和边界语义必须人工评价。回复率、赴约率和恋爱结果不能单独证明产品有效。

具体样本规模、评分一致性门槛和上线阈值待试标注后确定，不得在本文虚构达标数据。

## 11. Mock 与契约测试策略

建议仓库结构：

```text
project/
├── frontend/                     # Node.js；只调用 Gateway
├── Gateway/                      # 独立 C# 网关工程
│   ├── Gateway.csproj
│   ├── Gateway.sln
│   ├── scripts/
│   └── tests/gateway/             # 网关代理与契约回归
├── backend/
│   ├── contracts/                # OpenAPI、JSON Schema、C# DTO
│   ├── src/
│   │   ├── ExpressionStyleService/ # C#
│   │   ├── ContactContextService/  # C#
│   │   └── AdviceService/        # C#
│   ├── analysis-service/         # Python
│   └── tests/
│       ├── contract/
│       └── integration/
├── prompts/
├── rules/
│   ├── boundaries.md
│   ├── natural-expression.md
│   └── evidence-rules.md
├── examples/
│   ├── new-connection/
│   ├── build-relationship/
│   └── specific-difficulty/
├── evaluations/
│   ├── cases/
│   ├── rubric.md
│   └── baseline-results/
└── docs/
```

- `schemas/` 保存版本化 JSON Schema；
- `examples/` 只使用人工编写或明确授权的脱敏案例；
- `evaluations/cases/` 与提示词示例保持独立；
- 每个端点至少有成功、校验失败、无权访问和异常分支 Mock；
- C# `AdviceService` 与 Python `AnalysisService` 共用同一组 JSON Schema 样例；
- `tests/contract/` 同时验证 C# DTO 和 Python 模型可解析相同样例；
- `tests/integration/` 至少覆盖 Gateway 路由、INTERNAL allowlist 和一次完整分析链；
- 每次模型、提示词、规则或 Schema 变化都运行必要回归。

## 12. 开工责任与待决项

| 模块 | 契约责任 | 最终负责人 |
| --- | --- | --- |
| Node.js Frontend | 输入、编辑、证据展示、反馈与删除确认；只调用 Gateway | `OWNER-TBD` |
| C# `api-gateway` | 身份隔离、公共路由、INTERNAL allowlist、统一错误信封 | `OWNER-TBD` |
| C# `expression-style-service` | 表达习惯 CRUD、用户隔离和版本控制 | `OWNER-TBD` |
| C# `contact-context-service` | 联系人、消息、事件、偏好、硬边界、上下文裁剪与删除 | `OWNER-TBD` |
| C# `advice-service` | 分析编排、幂等、Schema/引用/边界校验和建议持久化 | `OWNER-TBD` |
| Python `analysis-service` | LLM adapter、单次调用、重试、超时和结构化输出 | `OWNER-TBD` |
| Shared contracts | OpenAPI、JSON Schema、C#/Python 兼容样例 | `OWNER-TBD` |
| Rules & evaluation | 自然表达、边界和安全案例及人工评分 | `OWNER-TBD` |
| Privacy | 保留期、日志、备份、删除与供应商协议 | `OWNER-TBD` |

编码前仍需确认：

- [ ] 正式产品名、Node.js 前端框架、.NET 版本、Python 版本和 Web 框架；
- [ ] 身份、账户和匿名试用方案；
- [ ] 数据存储与加密方案；
- [ ] 各 C# 服务的数据库选型和独立 schema；
- [ ] LLM 供应商、模型版本和数据处理条款；
- [ ] 各字段限制是否需要按实际 token 成本调整；
- [ ] 临时上下文的保留期限；
- [ ] 模型超时、重试次数和限流额度；
- [ ] 正式 JSON Schema 与自动化契约测试位置；
- [ ] 人工评测样本量、参与者结构和上线门槛。

## 13. 完成标准

一个服务或端点只有同时满足以下条件，才可在 README 或界面中标为已完成：

1. 请求和响应与本文类型一致；
2. 正常、校验失败、权限失败和模型失败分支均有测试；
3. 证据引用经过真实 ID 校验，不以模型自述为准；
4. 用户可查看理由、未知信息并编辑建议；
5. 明确边界不会被结构化标签直接绕过；
6. 用户数据可按本文语义删除；
7. 服务只通过约定 API 访问其他服务的数据，不存在跨库读取或共享表写入；
8. 公共入口只经过 Gateway，INTERNAL 接口执行调用方 allowlist；
9. C# 与 Python 的契约测试能解析同一组版本化样例；
10. 不虚构尚未实现的模型版本、外部检索、自动发送或评测结论。

项目整体“有效”不能只由接口可运行证明。必须完成独立案例对照与人工评测，并如实记录有用、无效和存在分歧的结果。


### 文本批量导入增补

- POST /contacts/{contactId}/text-imports 输入为 { importId, messages: [{ sender, text, sentAt }] }，importId 为客户端生成的 UUID。每批 1–1000 条；sender 为 USER / OTHER / UNKNOWN；正文最多 4000 字符；时间必须带时区或为 null。请求仍受 1 MB 上限约束。
- 返回标准信封，data 为 { importId, contactId, importedCount, skippedCount, messageIds }。服务端在一次存储事务中校验联系人所有权并保存整批记录及导入回执；任一记录无效时不写入。消息按输入顺序创建，sequenceNo 为 null。
- 同一用户、联系人、importId、消息载荷的重试返回原消息 ID，importedCount 为 0、skippedCount 为批次大小；同一 importId 更换载荷返回 409。新 importId 是一次新的显式导入，不按相同正文或同一分钟时间静默去重。
- USER / OTHER 来源分别为 USER_SELF_REPORT / COUNTERPART_EXPLICIT，isVerbatim 为 true；UNKNOWN 来源为 USER_RELAY，isVerbatim 为 false。导入不调用模型。
- 中文导出文本由前端正则解析；年月日后的空格、单数字小时、可选秒数、CRLF、多行正文及表情占位文字均保留或规范化，时区固定 UTC+8；每条记录第二行若不符合标准年月日时间格式，或对应无效日历时间，则存为 sentAt=null；不再限定“时间未显示”这一字样，不从相邻消息推断，不丢弃重复贴纸。无空行的单行正文按“昵称→时间行→正文”三行结构识别；已知昵称或明确时间头之间保留多行正文。前端要求用户明确映射昵称身份，也可跳过指定昵称。


## 本地模型密钥配置增补（2026-10-25）

`GET /api/v1/me/model-credentials` 和 `PATCH /api/v1/me/model-credentials` 为用户授权的本地运行配置接口，由 Gateway 转发给 AnalysisService，沿用可信 `X-User-Id` 和 Gateway 身份校验，不开放 INTERNAL 分析入口。PATCH 仅接收 `deepseekApiKey`、`jevApiKey`，至少提供一项：遗漏字段保留原值，8–512 个非空格 ASCII 字符替换该密钥，`null` 删除本地覆盖并恢复环境变量默认值。空字符串、未知字段和无效类型返回 400。GET 和 PATCH 的 data 均仅含 `deepseekConfigured`、`jevConfigured` 两个布尔值，不回显密钥或密钥片段；响应 `Cache-Control: no-store`。

这是 AnalysisService 原有“无账号数据持久化职责”的本地运行配置例外：仅保存由当前 Windows 账户 DPAPI 加密、绑定逻辑用户的模型凭证，目录由 `MODEL_CREDENTIAL_DIRECTORY` 指定；不保存额外聊天、联系人、建议或表达习惯。页面不把密钥写入 Settings/localStorage。保存的 DeepSeek 密钥优先于 `DEEPSEEK_API_KEY`；保存的 Jev 密钥启用该用户的 Jev 复核并优先于 `TYPESAFE_API_KEY`；无本地覆盖则保留原环境变量与 `JEV_ENABLED` 行为。每次分析只使用该用户的独立凭证快照，密钥不进入模型提示词、输出、日志或建议缓存。环境变量和本地密钥均未配置时仍可启动并进入设置；发起分析时返回 `503 MODEL_UNAVAILABLE`。Windows 本地加密不可用、密文损坏或目录不可写返回 `503 CREDENTIAL_STORE_UNAVAILABLE`，不降级明文保存。清空社交背景和表达习惯不会清空本地模型凭证；需要移除本地覆盖时单独 PATCH 对应字段为 null。其他操作系统暂不支持页面持久化凭证，仍支持环境变量配置。


## 图片消息增补（2026-10-26）

消息创建/更新增加可选字段 `image`，旧客户端遗漏时默认 null，PATCH 遗漏时保留旧附件。非 null 时严格为 `{dataUrl, width, height}`：仅接受 `data:image/jpeg;base64,...`，解码后最多 256KiB；JPEG 签名与 SOF 尺寸需有效，声明尺寸必须与文件一致，宽高各为 1–1600 的整数。不接受远程图片 URL、SVG、额外字段或客户端提交的识别结果。附图消息允许 `text=""`；无图片时仍要求非空文字。移除最后的图片且无文字返回 400。附件与消息同属用户、联系人、版本及删除生命周期，不另设公开文件地址。

前端接受不超过 8MiB 的 JPEG/PNG/WebP，解码后最多 4000 万像素；重编码 JPEG 移除 EXIF 等元数据，压缩到最长边 1600px 且不超过 256KiB。单次分析最多选 2 张图片，超限返回 413 INPUT_TOO_LARGE；原有 1MiB 请求限制保留，100KB 文本上下文预算不含图片 Base64。

AnalysisService 在同一 60 秒分析预算内，至多增加一次包含所选全部图片的 DeepSeek 视觉请求。识别结果逐条核对 messageId，描述最多 1200 字，不确定性最多 5 项、每项 200 字；异常或格式错误直接报错，不降级忽略图片。生成及 Jev 接收同一份剥离 Base64、带 `imageAnalysis.sourceType=MODEL_INFERENCE` 的上下文。图片解读不是对方原话或确认事实，不能由照片认定人物身份、心理或好感；结果标记 vision-1.0 并保留识别误差提示。原始图像不进入日志、Jev 或自动表达习惯样本。

## Electron 本地桌面运行增补（2026-10-25）

Windows x64 桌面入口为 `betweenly://app`，由 Electron 主进程提供打包静态文件及公共 API 代理。渲染进程启用 sandbox、contextIsolation，关闭 Node integration；仅可请求固定应用源，无任意文件、任意上游地址或任意命令的 IPC 接口。桌面模式使用 Production 环境、独立数据目录和动态分配的回环端口，禁用开发身份；Gateway 的 DesktopAuth 显式开启时，只允许回环来源加每次启动随机生成的 `X-Desktop-Token`，绑定固定的本地用户 ID。主进程过滤客户端身份头后注入令牌，Gateway 再把本地身份转换为原有可信用户身份并剥离桌面令牌。INTERNAL 服务身份校验保持原样，其他非开发、非桌面模式继续拒绝公共请求。

桌面使用打包的 Python 和微信助手 EXE；.NET 服务及助手以 framework-dependent 模式发布，共用程序目录内的一份私有 .NET 8、ASP.NET Core 与 Windows Desktop 运行环境，通过 DOTNET_ROOT / DOTNET_ROOT_X64 指定，无须系统预装 .NET。监督进程先绑定 Windows Job，再启动自动继承该进程组的服务及后代进程；窗口退出、主进程断开或监督进程被终止时，一并清理该应用的服务，不通过全局进程名或固定端口终止其他程序。安装版数据、DPAPI 密钥和日志位于当前 Windows 用户的 `%APPDATA%/Betweenly/`，独立于网页开发版 `.runtime/mvp/data/`；不自动迁移，也不把项目 .env、聊天数据或开发环境加入分发包。


## 个人语料库增补（2026-10-28）

公共端点统一经 Gateway，ExpressionStyleService 所有权按可信用户身份隔离。样例结构为 `{text, situation}`，text 为 1–500 个 UTF-16 字符，situation 为 GENERAL / DAILY / CARE / HUMOR / INVITATION / APOLOGY / BOUNDARY。存储对象增加 `sampleId/version/createdAt/updatedAt`，不记录对方身份和聊天事实。疑似常见 API 密钥或私钥的文本返回 400，不回显文本。

| 方法 | 路径 | 契约 |
| --- | --- | --- |
| GET | `/api/v1/me/voice-corpus` | `{sampleCount,capacity:10000,revision,privacyVersion}` |
| GET | `/api/v1/me/voice-corpus/samples` | cursor/limit 分页（1–100），与其他列表信封相同 |
| POST | `/api/v1/me/voice-corpus/imports` | `{confirmedOwnWords:true,samples:[{text,situation}]}`，每批 1–500 条；同一事务校验、NFKC/空白规范化去重、容量检查与写入；返回状态字段和 importedCount/duplicateCount，201 |
| PUT | `/api/v1/me/voice-corpus/samples/{sampleId}` | `{text,situation}` 完整替换；必需 If-Match，返回新版本；外部用户 404，旧版本 409，重复样例 422 |
| DELETE | `/api/v1/me/voice-corpus/samples/{sampleId}` | 必需 If-Match，204；外部用户 404，旧版本 409 |
| DELETE | `/api/v1/me/voice-corpus` | JSON `{confirmation:"删除"}`，显式清空当前用户语料，204 |

所有写入受 1MiB 请求上限约束。重复导入可安全重试，重复键为规范化文本与 situation；不替换用户原始标点和大小写。容量溢出或批次无效不写任何行。多批导入可能部分完成，客户端显示已完成数，可重试去重。修改和删除仅影响当前用户。

`expressionStyle.usePersonalCorpus` 可选，遗漏默认 true，false 不发语料。原有 `learnFromMessages` 只控制当前联系人中的本人发言参考，两者独立。一般反馈仅存反馈，只有用户通过语料导入确认才学习修改后的文案。

INTERNAL 仅允许 AdviceService：`POST /internal/v1/voice-queries` 输入 `{userGoal,query}`，query 最多 4000 字符，返回 `{revision,privacyVersion,sampleCount,medianLength,examples:[{sampleId,text,situation}]}`；examples 最多 8 条，由当前用户语料中选择。`GET /internal/v1/users/{userId}/voice-corpus` 返回状态，路径用户必须等于可信身份。公共请求不得直接访问这两个接口。

AdviceService 将上述有界对象放入 AnalysisInput.context.personalVoice；ContextQuery 原事实结构不变，个人语料不增加 evidenceRefs 的允许集合。Python 严格验证字段、数量、类型、样例 ID 和中位长度。生成和 Jev 都只把其视为不可信风格数据；手动偏好、事实与边界优先。ASSESS_AFFINITY 不查询或发送语料。引擎版本在使用样例时追加 personal-voice-1.0。

新增/修改/删除增加 revision；修改/删除另增加 privacyVersion。生成完成前再次读取并比较完整个人语料参考，变化返回 409。建议行在内部保存使用时的 privacyVersion（不改变公共 Advice 字段）；旧版本经历史/详情/幂等重放访问时返回 404，列表跳过。当前按用户整库版本保守失效，新增不使旧建议失效；未使用语料的建议不受影响。失效不等同于物理删除旧建议，用户仍通过建议删除或清空背景清理。详细限制见 docs/PERSONAL_VOICE.md。

本地 MVP 启动器显式设置 VITE_LOCAL_MVP=1 与对应 Gateway 代理；页面只在 Vite DEV 且浏览器主机为回环地址时启用旧开发身份入口。生产构建、正常账号网页版和 Electron 身份流程保持各自校验。项目内存在 .runtime/dotnet-sdk 时优先使用该 SDK。
