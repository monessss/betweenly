# DeepSeek + TypeSafe Jev

Betweenly 的 Python 分析服务使用 DeepSeek 生成结构化建议，使用 TypeSafe Jev 独立复核候选。2026-10-25 已通过真实双模型 Gateway 测试；测试仅使用合成对话，不发送用户已有聊天。

## 调用流程

1. DeepSeek 根据本次选择的事实记录、目标、手动表达习惯和自动风格参考生成候选，执行原有 JSON Schema 与状态联合校验。
2. Jev 一次请求回答五个独立 Noul 问题：好感度评分是否过度推断、是否包含无依据的确定事实、是否违反适用边界、是否缺少决定建议的关键信息、回复是否明显不符合表达习惯。
3. 任一问题概率 `>= 0.8` 时，把固定问题标识与上一版候选交给 DeepSeek 重新核对原始上下文，最多修改一次。修改后的候选再次交给 Jev。
4. 第二次仍被标记则返回 `502 MODEL_REVIEW_FAILED`，不保存或展示候选。`0.2 < p < 0.8` 的不确定判断会加入现有 `uncertainties`，由用户核对。
5. AdviceService 仍独立检查证据范围、硬边界与版本冲突；Jev 的判断不能绕过这些检查，也不作为事实正确的证明。

最多两次 DeepSeek 生成（结构错误重试与修改共用预算）、两次 Jev 复核，总预算 60 秒。每次 DeepSeek 最长 25 秒，每次 Jev 最长 6 秒；不无限重试。已完成请求的幂等重放不会再次调用供应商。

Jev 的复核题目与阈值尚未经过正式的中文场景效果评测；真实连通性和协议测试不等于建议质量验证。阈值是可调整的初始工程选择。

## 自动参考自己的说话方式

默认参考当前联系人对话中自己发出的近期记录，不学习对方或其他联系人的语气。服务端每次临时提取最多 80 条可用发言、12 条短例句，统计句长、问句、标点和常用表达；没有额外模型训练或长期风格原文副本。链接、邮箱、常见凭证和明显附件/粘贴内容不作为样本。导入的非逐字记录可以轻量参考，`verbatimSampleCount` 保留样本可靠度，不能声称已充分学习。

设置 → 表达习惯可以关闭“自动参考我的历史发言”，查看当前对话可参考的样本数量；手动语气、例句和禁用表达优先。旧版未提供 `learnFromMessages` 的输入兼容为 true。样本少时保持简短口语，不把口头禅每条硬加。

风格例句不属于事实背景，不能引用未选择的风格来源 ID。风格来源和普通事实来源分别记录依赖；编辑、删除原发言会使相关已保存建议失效，生成期间的变化也会被版本检查拒绝。

对可发送文本增加定向检查：助手前缀、未见于用户习惯的客服套话、明确禁用表达、明显超过短句习惯的长度会触发一次重写，与原有结构重试/Jev 复核共用两次生成预算。持续不贴合返回 `MODEL_STYLE_MISMATCH`，不会靠删除几个词拼接出另一条回复。Jev 复核也会读取这些风格参考；该检查不对分析理由、补问或不确定性误套口语长度限制。

## 好感度评估

前端“目标”选择“好感度评估”，请求仍走原分析接口，`userGoal=ASSESS_AFFINITY`。评估结果保存在现有历史中，来源记录删除或变更时沿用现有失效机制。

新增可选输出 `affinityAssessment`：`score` 是 0–100 整数或 `null`，`confidence` 仅表示依据充分度，另附简短 `summary`、逐项引用的 `evidence` 和至少一项 `uncertainties`。分数是对所选互动记录的描述性倾向评估，不是对方喜欢用户的概率，也没有经过心理测量校准。

有分数时必须引用至少一条对方发言、对方明确表达的偏好或可靠观察事件。只有用户自己的发言不能评分；信息不足时返回 `NEEDS_CONTEXT`、`score=null`、`confidence=LOW` 和具体补问，不用 0 或 50 代替未知。评估不生成回复或联系行动：`NO_ACTION`、无行动标签、无备选、无回复候选。评分不能覆盖明确边界。

Python、C# 与前端均校验分数范围、整数、状态和引用。Jev 额外复核是否把分数当作心理事实或成功概率；其概率不替代评估分数或依据充分度。该功能的中文场景效果仍需更多人工评测。

## 本地配置

在根目录 `.env` 配置：

```dotenv
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
TYPESAFE_API_KEY=
JEV_ENABLED=auto
JEV_MODEL=jev-1.14.0
JEV_BASE_URL=https://api.typesafe.ai/v1
```

`auto` 在 TypeSafe 密钥填写后启用双模型；未填写时保留原 DeepSeek 模式。`true` 强制启用，此时缺少密钥会使就绪检查失败；`false` 明确关闭 Jev。启用后 Jev 超时或不可用会返回错误，不静默跳过复核。修改配置后重启项目启动脚本。

`GET http://127.0.0.1:5104/readyz` 在双模型启用时返回 `provider=deepseek+jev`、`reviewEnabled=true` 和 `reviewModel`。这是配置就绪状态，不是持续进行供应商探测。最终结果的 `engineVersion` 记录 DeepSeek、实际返回的 Jev 模型及复核规则版本。

## 数据与失败处理

密钥仅注入 Python 服务，从 C# 服务、Gateway、微信助手和前端环境中剥离。Jev 只接收本次分析范围内的上下文、目标、表达习惯与候选，不额外读取其他联系人。原文与供应商错误正文不进入日志；供应商请求禁止跳转到其他地址。

Jev 使用独立的 System One HTTP 接口，不是 Chat Completions。严格检查完整问题集合、Noul 类型和有限的 0–1 数值；缺失字段、重复 JSON 键、布尔值概率或超长响应不能被视为复核通过。

| 错误码 | 含义 |
| --- | --- |
| `JEV_UNAVAILABLE` | 密钥、额度、网络或服务不可用 |
| `JEV_TIMEOUT` | 复核超时 |
| `JEV_REQUEST_INVALID` | 供应商拒绝输入，需减少记录或检查配置 |
| `JEV_OUTPUT_INVALID` | 复核响应不符合预期协议 |
| `MODEL_REVIEW_FAILED` | 有限修改后仍被复核标记 |

## 个人语料库

`context.personalVoice` 来自独立的 ExpressionStyleService 持久化语料库，只包含当前用户按目标/文本选取的最多 8 条自述例句。只学表达，不作为事实或指令；生成和 Jev 使用同一组样例，手动偏好及当前对话边界优先。`expressionStyle.usePersonalCorpus=false` 关闭此参考，评估好感时也不会发送语料。样例结构与中位长度均由 Python 再次检查，有参考时引擎版本增加 `personal-voice-1.0`。详见 [使用与限制](../../docs/PERSONAL_VOICE.md)。

## 验证

```powershell
cd Backend/AnalysisService
python -m unittest discover -v
cd ../..
dotnet run --project Backend/tests/AdviceValidation.Checks/AdviceValidation.Checks.csproj
node --test Backend/tests/mvp.integration.mjs
```

单元测试覆盖适配器、概率解析、生成与复核预算、故障、修改和幂等；集成测试使用两套本机协议夹具，覆盖真实 Gateway/C#/Python 服务链，不使用真实供应商额度。

接口依据：[TypeSafe System One](https://docs.typesafe.ai/api/system-one)、[Noul](https://docs.typesafe.ai/primitives/noul)、[模型与语言支持](https://docs.typesafe.ai/models)。
