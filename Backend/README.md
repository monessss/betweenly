# Betweenly Backend

已接入 TypeSafe Jev `jev-1.14.0`，与 DeepSeek 配合完成生成、复核和一次必要修改。填写根目录 `.env` 的 `TYPESAFE_API_KEY` 后默认启用，真实双模型测试已通过。流程、配置和错误处理见 [双模型分析服务](AnalysisService/README.md)。

## 服务职责

| 服务 | 实现 |
| --- | --- |
| ExpressionStyleService | 读写、删除自己的表达习惯；替换和删除检查 `If-Match` |
| ContactContextService | 联系人、消息、事件、偏好与边界 CRUD；上下文范围检查；自动纳入硬边界；数据清除与建议删除协调 |
| AdviceService | 选取上下文与风格、模型编排、结构和证据校验、建议历史、反馈和实际后续；幂等及并发修改检查 |
| Python AnalysisService | DeepSeek JSON 生成、有限重试、错误映射；独立验证共享 Schema，不读业务存储 |
| Shared | HTTP 信封、字段校验、原子文件仓储、内部 Gateway 客户端、模型输出校验 |

跨服务请求都经过 Gateway INTERNAL 白名单。每个业务服务使用独立密钥和独立存储目录；浏览器没有服务密钥。新增内部路由 `POST /internal/v1/contacts/{contactId}/outcomes` 只允许 AdviceService 调用，用于将真实后续写入 Context 服务，事件的 `relatedAdviceId` 由 AdviceService 确定。

## 构建

在 `Backend` 目录：

```powershell
dotnet restore Backend.sln --configfile NuGet.Config
dotnet build Backend.sln --no-restore
```

推荐通过根目录 `scripts/start-mvp.ps1` 一起启动，避免手动配置内部密钥。独立启动业务服务必须设置 `GATEWAY_KEY`、`DATA_DIRECTORY`；Context/Advice 还需要 `INTERNAL_GATEWAY_URL` 和 `SERVICE_CREDENTIAL`。Python 需要 `DEEPSEEK_API_KEY`、`GATEWAY_KEY`，端口可用 `ANALYSIS_PORT` 设置。

## 行为与失败处理

- 所有业务记录按可信 `X-User-Id` 隔离；不存在和跨用户资源统一 404。
- JSON 类型、枚举、长度、来源、UUID、时间、消息序号、重复字段和未知字段均进行校验。不会接受浏览器提供的 owner、版本或状态作为可写业务字段。
- PATCH/DELETE 检查 `If-Match`；首次创建表达习惯无须版本，已有配置更新时必须带版本。
- 分析必须带 UUID `Idempotency-Key`。同一用户、同一键、同一规范化载荷成功后重放原结果；改变载荷返回 409。已删除的结果不会因重放被恢复。
- 分析生成在本地 Advice 进程串行执行；队列等待超过 1 秒返回 429，避免重复模型调用。模型失败未保存为成功，可以用原键、原输入重试；上下文已变更时应换新键。
- DeepSeek 使用 JSON Output，最多两次结构生成尝试；单次 socket 超时默认 25 秒。无效输出返回 502、供应商不可达或鉴权/余额问题返回 503、调用超时返回 504。不会以固定示例伪装模型成功。
- `contracts/analysis-output.schema.json` 同时由 C# 和 Python 校验；C# 额外校验引用、状态联合约束、硬边界和候选 ID。模型文本中的推断仍需人工审阅，结构校验不能证明其语义正确。
- 普通记录只发送选中的内容；有效硬边界自动纳入。带条件的硬边界目前保守纳入，由模型遵守 `appliesWhen`，宁可少给建议。
- 修改原始记录会清理依赖建议，防止旧引用误导；新增/修改边界或联系人背景会清理该联系人的建议。分析期间数据变更时，结果不会落库。
- 删除先持久化 `pending`，阻止读取/新分析，再经 Gateway 清除建议与反馈，最后删除正文。依赖判断覆盖所有发送给模型的输入，不只模型声称引用的输入。来源删除也移除引用它的派生偏好记录。
- 跨服务清理失败返回 503 `DELETION_INCOMPLETE`，保留待删除状态，可重试原操作。清除全部社交数据会删除联系人、记录、建议、反馈与幂等映射，保留表达习惯。
- 日志不记录聊天正文、提示词、供应商响应或密钥。Python 仅在进程内缓存分析输出，TTL 5 分钟、上限 128 项，供内部重试使用；后台每 5 秒清理过期项。

## 存储与 MVP 范围

采用每服务独立的 JSON 文件仓储，修改时复制快照、flush 后原子替换；文件锁阻止两个进程写同一文件。重启可以恢复联系人、记录、表达习惯、建议、反馈和成功幂等结果。适合单机少量数据验证；数据当前是本地明文文件。

这个版本是本地 MVP，尚未提供正式登录、生产数据库、加密与备份体系、多实例部署和完整语义评测。Gateway 的开发用户头只在 Development 生效，服务只监听本机，不能将当前开发身份方案直接用于公网部署。

前端本次分析使用保存后的记录，`ephemeralContext` 非 null 明确返回 422；没有静默将临时原文长期保存。原始问题/草稿不作为独立上下文档案保存，只保存其校验后的建议结果与载荷摘要。完整临时背景生命周期、正式 OpenAPI 和模型效果评测留待后续。

## 测试

本地微信读取、原子批量导入和短期预览实现见 [WeChatAssistant/README.md](WeChatAssistant/README.md)。助手由 Context 服务按用户请求启动，通过微信复制纯文本；OCR 仅确认菜单和会话名称。不增加网络服务端口，不访问模型。Context 服务可通过 `WECHAT_ASSISTANT_PATH` 设置助手程序集位置。

`tests/mvp.integration.mjs` 启动真实 C#/Python/Gateway 进程，使用隔离的 6080/6101–6104 端口、独立临时目录和 DeepSeek 协议测试服务。覆盖所有权/版本、分页、最小上下文、幂等、持久化重启、反馈、后续、状态联合约束、错误输出、不可达/超时、生成期间修改、硬边界和删除联动，不消耗模型额度。

`AnalysisService/test_analysis.py` 覆盖共享 Schema、严格 JSON、输入范围、Schema 版本、缓存隔离、重试和过期。根目录 `scripts/smoke-deepseek.mjs` 使用真实模型并复用前端 `assertAdvice` 校验输出；它只上传内置虚构测试文字，完成后清除该随机用户的数据。
