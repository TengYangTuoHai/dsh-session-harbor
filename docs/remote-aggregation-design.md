# 同一工作台中的多设备会话

用户约束：本机外壳、侧边栏和主区域一直保留；通过 SSH 使用远端 DSH；本机和远端会话混入 Pinned / Active / Working / Settled；新会话按设备选择项目，再在所属设备创建并打开。

## 运行时边界

每个远端设备拥有自己的原生 Client 上下文：Connection、Remote、Sessions、Workspaces、UiSession、Conversation 和 Slots。原生组件、事件装配、输入、附件、审批、用户问答和模型选择继续由 DSH 的官方 Client 插件负责。插件提供连接、模块环境、存储与嵌入边界。

本机 `main` 的 `t3-device-conversation` 入口渲染设备私有 Slots 的 `root`。私有 root 只组成正文、右侧详情和浮层。本机的 root、AppFrame、混合侧栏和其他主面板不被替换。不使用 iframe、整页导航或全局 transport 切换。

侧栏与主区域的会话选择使用 `{targetId, sessionId}`；项目选择使用 `{targetId, workspaceId}`。远端原生上下文内部使用该设备原始 ID。即使两台设备存在相同 ID，Client Controller、草稿和界面存储也各自隔离。

## 可信官方模块与持久化

`native-runtime-host.js` 读取远端结构化启动数据，按连接世代准备运行时描述。官方 Client 代码来自匹配 release 的本机资源；跨版本仅使用 SSH 服务已有的 verified official cache。缓存缺失或版本不匹配会明确拒绝，不能改用另一版本的本机代码，也不执行远端返回的 JavaScript。

描述与资源请求都带设备、连接和运行时身份。资源路由要求本机 owner，检查官方包身份、图依赖、包内 chunk、连接世代、MIME、UTF-8 和大小。代码的词法环境使用该设备的 `window/globalThis/localStorage/sessionStorage/document` facade，工厂注册进入该设备的模块表。

动态模块直接读取的 Storage 与平台 `dsh-client-store` 持久化名称共用 `t3.device.<namespace>.` 前缀。平台 store 的状态算法保持原实现，facade 只改 `defineStore(spec.persist)` 和 `createSnapshotStore(options.persist.name)` 的存储名称。真实页面 globals 和 Storage 不被替换。

设备的文档事件按当前活跃区域过滤，原生浮层使用该设备的容器。远端原生控件跟随本机界面语言。工作台在后台为已就绪的 SSH 连接启动设备客户端，直到对应连接关闭。项目导航在已有明确会话选择后初始化，使用远端会话 ID 打开原生对话。

本机窗口接收键盘输入。活动设备接收自己的会话命令，本机外壳继续处理侧栏等窗口操作。设备组件的局部键盘监听由其容器限定。`shortcuts-bridge.js` 对当前支持版本的输入方法作可逆适配，每个设备记录并释放自己的样式与监听器。

## 新会话与导航

新会话的设备入口放在原生项目选择之前。前置页并列呈现设备选择与该设备的项目列表；选择设备本身只更新选择，选择项目后才创建或复用空会话，并在同一主区域打开。

本机项目走本机 `uiWorkspace`。远端项目走所属设备的创建接口。打开会话时优先复用设备客户端的 Sessions 目录。新建或分叉返回的会话若尚未进入目录，会先刷新目录，再按返回的 ID 打开。

切回本机会话会使等待中的远端导航失效。设备断线会取消仍在准备的运行时；旧运行时即使晚到，也不能注册为新连接或覆盖后来的选择。加载失败有重试入口，禁止静默回落到本机输入框。

## 索引、四态与会话操作

远端是会话、置顶、归档与 settled 的权威；本机镜像用于混合侧栏和断线缓存。每个连接 task 独占 Client 与订阅，异步结果提交前检查连接世代。Workspace 流持续消费 baseline 和增量。Snapshot 以 epoch/revision 合并，并在旧列表返回后重放较新的运行状态。

本机与远端的分组优先级依次为 Pinned、Settled、Working、Active。等待用户交互的普通会话排在 Active 顶部。普通运行结束保留两秒退出缓冲。设备原生 UiSession 的 pending interaction 与 running 状态参与远端分组。

侧栏通过原生 context menu 呈现远端会话的打开、置顶、完成、重命名、分叉、复制 ID 与归档。离线写操作禁用。会话右键不执行项目删除。项目管理在自己的入口中完成。

同项目的新建共享一次创建；已返回但尚未进入镜像的空会话 ID 临时保留。远端已创建、回包却丢失的跨连接重试，仍不能提供分布式 exactly-once 保证。

## 部署与验证

本机插件要求 DSH `0.2.2-rc.3` 或 `0.2.2-rc.5`，以及提供 `sshManager`、`sshRemoteBridge` 的 SSH 插件。远端的 settled 和 placement 实时同步依赖远端安装本侧栏插件。原生会话可用性还取决于匹配 release 的可信官方 Client 图和所需远端 Web 能力。

远端首次安装侧栏插件会执行既有的一次性 idle 会话迁移；更新不应重新执行已完成的迁移。

构建与纯本地回归：

```sh
node tools/build-client.mjs
node tools/build-client.mjs --check
node --test t3-session-sidebar/*.test.js
```

纯本地测试覆盖协议、认证资源路由、双设备相同 ID 的存储隔离、生命周期、重连、取消、状态覆盖、连续新建和会话操作。它们不证明真实 GUI 已渲染或完成了一轮对话。

真实验收必须在已有工作台完成：打开本机/远端会话；按设备选择项目并新建；确认执行设备与目录；流式正文、停止、审批、问答、模型和附件；四态和菜单；断线重连；刷新恢复。当前连接的运行态、安装应用结果和 GUI 操作证据应分别记录，不能相互代替。
