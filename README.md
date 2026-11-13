# dsh-t3-code

DeepSeek Harness（DSH）插件：把会话侧边栏换成 T3 Code 风格的收件箱——Pinned / Active / Working / Settled 四组，支持标题搜索、折叠分组、整行点击打开会话、置顶 / 完成 / 重新激活，以及运行中会话的强调色状态（`⟳ 工作中 39分钟`）。Working 与 Settled 是贴在列表底部的搁架，空隙留在活跃会话之后，和 T3 Code 一致。

A DeepSeek Harness plugin that swaps the session sidebar for a T3 Code style inbox: Pinned / Active / Working / Settled shelves, title search, collapsible groups, whole-row open, pin / settle actions, and an accent status label (`⟳ Working 39m`) for live runs. Behaviour details live in [t3-session-sidebar/README.md](t3-session-sidebar/README.md).

## 安装 Install

插件根目录是 `t3-session-sidebar/`，它的 `package.json` 声明了 `dsh.bundle.patch`。把这份 checkout 链接进一个 DSH profile：

```sh
dsh plugin --profile demo add ./t3-session-sidebar
dsh --profile demo --dump-config   # 应能看到 "# == @local/dsh-t3-session-sidebar" 层
dsh --profile demo
```

移除：`dsh plugin --profile demo remove @local/dsh-t3-session-sidebar`。

## 开发 Develop

```sh
cd t3-session-sidebar
node --test logic.test.js placement-controller.test.js index.test.js migration.test.js
node ../ui-render-check.mjs   # 在 jsdom 里渲染行结构并断言分组与状态
node ../ui-preview.mjs        # 无头 Chromium 截图到 .preview/，并检查溢出
```

两个界面脚本借用一份 DSH 检出里的 react / react-dom / jsdom / playwright，用 `DSH_CHECKOUT=/path/to/deepseek-harness` 指定；脚本顶部的默认值是我本机的路径。

## 上游与许可 Upstream and license

分组规则（Pinned / Active / Working / Settled、两秒退出缓冲）与会话行的呈现改自 [T3 Code](https://github.com/pingdotgg/t3code) 在 `095611d1` 的实现（MIT, © T3 Tools Inc.）；存储、右键菜单、会话状态与侧栏插槽来自 DSH 自身的插件 API。本仓库以 MIT 发布，见 [LICENSE](LICENSE)。
