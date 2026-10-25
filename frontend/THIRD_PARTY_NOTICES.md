# 第三方来源

## Koishi

- 上游：<https://github.com/koishijs/koishi>
- 本地：`../references/koishi`
- 下载提交：`97d5c395750cec37b772e0b94dc63c427e3bb868`
- 主仓库许可：MIT，全文保留于 `public/licenses/koishi-MIT.txt`。

## Koishi WebUI

- 上游：<https://github.com/koishijs/webui>
- 本地：`../references/koishi-webui`
- 下载提交：`1dc5c0e1c76a207c2ec48697d4b56364cfe28dce`
- 控制台客户端及主题许可：AGPL-3.0，全文保留于 `public/licenses/koishi-webui-AGPL-3.0.txt`。
- 作者：Shigma 和 Koishi contributors。

`src/koishi-theme.css` 根据上游 `packages/client/app/styles/index.scss`、`layout.scss` 改编，保留浅色/深色主题层次、控制台尺寸与颜色变量，并增加 Betweenly 的选择器和组件别名。该文件保留上游 AGPL-3.0 声明。

页面结构参考了以下源码；Betweenly 的 React 业务流程继续使用本项目的数据契约：

```text
packages/client/app/theme/activity/index.vue
packages/client/app/theme/activity/item.vue
packages/client/app/theme/activity/button.vue
packages/client/app/layout/layout.vue
packages/client/app/layout/header.vue
packages/client/app/theme/status.vue
packages/client/app/home/welcome.vue
packages/client/client/components/layout/card.vue
```

这些文件记录最初参考的活动栏、布局和主题来源。当前版本进一步重新设计为单侧联系人列表和双栏文档工作区，保留改编的明暗颜色变量、统一圆角及许可声明。品牌和业务内容采用 Betweenly。

公开分发或部署包含这些改编文件的版本时，须保留相应许可及来源，并遵守适用的上游许可要求。构建会通过 Vite `public/` 将许可全文一同输出。
