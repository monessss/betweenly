# Betweenly 本地微信助手

自动读取只允许受信桌面版调用。网页端不可触发服务器电脑的助手，即使请求经过 localhost 代理、携带登录身份或伪造 X-Forwarded-For 也不允许。桌面 Runtime 为 Gateway 和 Context 服务分配每次启动的独立 WECHAT_IMPORT_TOKEN，Gateway 丢弃外部同名请求头并在桌面认证通过后注入；Context 在启动助手和提交预览前再次校验。普通网页部署不得配置这个本机能力凭证。

Windows 本机读取助手，已在微信 **4.1.15.13** 实测按条数向上读取 50 条。读取的是当前打开对话中可复制的纯文本，不是完整历史数据库。

## 使用

1. 使用根目录 `scripts/start-mvp.ps1` 启动 Betweenly。
2. 在电脑微信中打开要导入的对话，保持窗口还原、文字可见。
3. 在 Betweenly 选择对应联系人，点击记录标题旁的 **从微信导入**。
4. 输入读取条数（1–100，默认 50），点击 **读取微信**；助手从当前画面向上加载，读够即停止。
5. 核对微信会话名称、原文和说话人，确认对应联系人后，点击 **导入 N 条**。

仅保留纯文本：转发聊天记录卡片、图片和表情包跳过，emoji 与已知微信表情占位符移除。汉字和中文标点旁的多余空格清理，英文词间保留一个必要空格。预览可直接修改。未确认说话人和可能重复的记录默认不选；完整日期没有可靠显示时保留时间未知。群聊若被检测到，非本人消息降为未确认，避免自动归给某一个联系人。

关闭读取中的弹窗会取消请求。微信未响应上翻、没有更早内容或达到本次读取时限时，会显示实际读取条数并保留已读结果，不用重复内容补足。也可以在微信手动上翻后重新读取。

翻页按画面位移和气泡位置确认重叠；同一消息只计一次，已读消息不再重复复制。真实连续发出的相同文本保留为不同消息。无法可靠确认重叠时停止读取，避免重复计数。

## 依赖与运行

需要 Windows 10/11、.NET 8 Windows Desktop Runtime、系统 Windows PowerShell 和已安装的中文 OCR 语言。本机已具备这些组件；无须第三方聊天导出工具。其他微信版本、主题或布局变化仍需实际适配，不能保证通用。

```powershell
cd Backend
dotnet restore WeChatAssistant/WeChatAssistant.csproj --configfile NuGet.Config
dotnet build WeChatAssistant/WeChatAssistant.csproj --no-restore
dotnet WeChatAssistant/bin/Debug/net8.0-windows/Betweenly.WeChatAssistant.dll status
```

命令行 `capture 50` 按条数读取并返回 JSON，参数支持 1–100，省略时默认 50。正文属于本地敏感数据，请勿把它写入常规日志。默认启动脚本会设置 Context 服务的 `WECHAT_ASSISTANT_PATH`，浏览器不直接启动本机程序，也没有额外助手端口。

## 数据处理

- 定向捕获微信窗口，通过消息气泡的纯文本复制菜单取原文，不移动全局鼠标、不发送消息。菜单关闭和上翻事件只发送给微信窗口。窗口或内容发生变化时停止读取。
- 用气泡背景定位消息；系统 OCR 仅确认复制菜单和会话名称，不转写正文。截图经内存管道传递，不生成截图临时文件，不调用 DeepSeek。
- 读取前备份剪贴板，每条复制后还原；发现其他程序修改剪贴板就停止，不覆盖新内容。无法备份的格式会报错；复制瞬间取消或进程异常退出可能中断还原。读取时请勿切换对话、滚动或使用剪贴板。
- 读取结果先保存在 Context 服务内存，5 分钟过期；导入前不写入长期聊天记录。确认后，所选消息由 Context 服务一次事务保存。
- 复制文本会移除表情和整理空格，因此不自动标为逐字原文；来源使用 `USER_RELAY`，可在正常记录编辑中进一步修正。
- 同一预览提交可安全重试。重新读取时，相似文本只做潜在重复提示；没有日期和稳定消息 ID 时，不能据此确认两次发言是同一条。

## 验证

```powershell
cd Backend
dotnet restore tests/WeChatAssistant.Checks/WeChatAssistant.Checks.csproj --configfile NuGet.Config
dotnet run --project tests/WeChatAssistant.Checks/WeChatAssistant.Checks.csproj --no-restore
node --test tests/mvp.integration.mjs
```

前者检查深浅主题气泡定位、中文空格、英文空格、emoji、菜单过滤及重叠页；MVP 集成测试验证网页不能触发助手。根目录的 `node Backend/tests/wechat-boundary.integration.mjs` 使用协议夹具，另行验证桌面身份、预览、原子导入、幂等、重复消息保留，以及伪造本机 IP/请求头时不会启动助手；该测试不读取真实微信。测试构建输出可通过 BETWEENLY_BACKEND_TEST_OUTPUT 和 BETWEENLY_GATEWAY_TEST_OUTPUT 指定。
