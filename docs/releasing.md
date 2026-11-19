# 发布 Session Harbor

首次使用前，在 npm 的 [`dsh-session-harbor` 包设置](https://www.npmjs.com/package/dsh-session-harbor/access)中添加 GitHub Actions Trusted Publisher。组织填 `TengYangTuoHai`，仓库填 `dsh-session-harbor`，工作流文件填 `release.yml`，环境留空，并允许 `npm publish`。[npm 配置说明](https://docs.npmjs.com/trusted-publishers/)

1. 在 `dsh-session-harbor/` 运行 `npm version <新版本> --no-git-tag-version`，同时更新包清单和锁文件。更新 README 中的已发布版本和兼容说明，界面改动涉及截图时同步更新截图。
2. 将版本更新合入 `main`，等 CI 通过。为该提交创建与包版本一致的 `v<版本>` 标签，推送该标签。
3. 在 Actions 查看 `Release`。它运行 CI，打包一次，先发布到 npm，再把同一份 `.tgz` 附到 GitHub Release。发布完成后可在 GitHub 补充面向用户的更新说明。

如果工作流中途失败，修复原因后重跑。已经上传且校验值一致的安装包会被复用。若同一版本已发布了不同的安装包，请用新版本号发版。
