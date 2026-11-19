# dsh-t3-code

DeepSeek Harness 插件：在同一工作台的 Pinned / Active / Working / Settled 四组中管理本机和 SSH 远端会话。远端正文使用该设备独立的原生 DSH Client，在本机主区域呈现；新建会话先选设备，再选该设备的项目。

A DeepSeek Harness plugin that groups local and SSH device sessions in one workspace and opens native conversations in the same main area. New sessions choose a device before a project.

行为、依赖和限制见 [插件说明](t3-session-sidebar/README.md)；运行时边界见 [设计与验收范围](docs/remote-aggregation-design.md)。

## 构建与安装

当前插件版本 `0.2.2`，支持 DSH `0.2.2-rc.3` 和 `0.2.2-rc.5`。先在仓库根目录构建：

```sh
node tools/build-client.mjs
```

在 DSH 插件管理器中安装或更新本地 `t3-session-sidebar` 目录。该目录的 manifest 声明 bundle patch、元数据、图标、Host 和 Client 入口。替换已加载版本后，按插件管理器返回的应用状态重启当前 DSH，再刷新原工作台。新开开发服务器不会更新已有 GUI。

在 DeepSeek Harness 的「设置 → T3 SSH」里，可从本机 SSH 配置选主机，也可手动输入 SSH 地址。连接就绪后，远端会话会同步到侧栏。远端安装 T3 侧栏插件后，可持久化并同步该设备的 Settled 状态。

## 验证

```sh
node tools/build-client.mjs --check
node --test t3-session-sidebar/*.test.js
```

纯本地测试验证协议、身份隔离和状态机。GUI 验收必须使用当前已认证的 DSH 工作台，覆盖新建与打开、流式正文、停止、审批、问答、模型、附件、菜单、断线重连及刷新恢复。历史 jsdom / 独立页面截图脚本不构成当前原生会话的验收证据。

## 上游与许可

分组规则（四组划分与两秒退出缓冲）及会话行呈现参考 [T3 Code](https://github.com/pingdotgg/t3code) 的 `095611d1` 实现（MIT，© T3 Tools Inc.）。本仓库使用 MIT 许可，见 [LICENSE](LICENSE)。
