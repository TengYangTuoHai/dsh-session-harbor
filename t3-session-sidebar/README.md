# T3 会话侧边栏

参考 [T3 Code 固定版本的分组逻辑](https://github.com/pingdotgg/t3code/blob/095611d1b55930ba23e22068b6659df4c4b53f83/apps/web/src/components/Sidebar.logic.ts#L194-L205)和 [Working 分组](https://github.com/pingdotgg/t3code/blob/095611d1b55930ba23e22068b6659df4c4b53f83/packages/client-runtime/src/state/threadInbox.ts#L17-L32)，按 Pinned、Active、Working、Settled 分组。支持标题搜索、折叠分组、打开会话，以及手动置顶、取消置顶、完成和重新激活。正在等待用户操作的会话归入 Active；普通运行结束有两秒缓冲。已完成分组默认折叠（仍显示数量），其他分组默认展开；折叠状态只保存在当前界面中，切换侧栏或刷新后恢复默认。

会话行沿用 T3 Code 的行样式：Pinned、Active、Working 是两行卡片（上行为工作区名与相对时间，下行为标题与状态标记），Settled 是单行灰化样式，悬停时标题恢复主色。整行都可以点击打开会话；悬停或键盘聚焦时右侧的时间位置淡出，换成置顶、完成与“更多”按钮（悬停切换只对精确指针生效，避免触屏点按后卡在悬停态）。相对时间分桶与原生侧栏一致（刚刚/5分钟/9小时…）。

首次升级时，已有的非空、未归档、未运行的普通会话会一次性移至 Settled（包括取消其置顶）；正在运行的会话不受影响，之后新会话和重新激活的会话不会被再次迁移。Pinned 没有可显示的会话时不显示分组标题。

置顶使用 DSH 的置顶状态；Settled 保存在插件自己的 Host 存储域中，不会归档或删除会话。置顶与完成涉及两个存储服务，操作中发生错误时可能只完成其中一步；界面会重新读取实际状态。若通过原生侧边栏直接置顶已完成的会话，两种标记会暂时并存：该会话显示在 Pinned，使用“重新激活”可清除完成标记。

在会话行右键、点击“更多”按钮，或聚焦标题后按 Shift+F10，可以打开 DSH 原有会话菜单，其中保留置顶、重命名、分叉、复制 ID 和归档，并增加完成或重新激活。侧边栏底部的切换按钮可返回原生浏览器，以使用原有的工作区管理和完整搜索。这个初版没有实现 T3 Code 的自动 Settled、拖拽排序、Snooze 或 PR 联动。

运行测试：`node --test logic.test.js placement-controller.test.js index.test.js migration.test.js`。界面结构可在 jsdom 中离线渲染：`node ../ui-render-check.mjs`；`node ../ui-preview.mjs` 还会用无头 Chromium 把静止态与悬停态截图写到 `../.preview/`。两者借用一份 DSH 检出的 react/react-dom/jsdom/playwright，可用 `DSH_CHECKOUT` 指定路径。
