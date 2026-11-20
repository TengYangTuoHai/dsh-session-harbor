# Session Harbor

English · [简体中文](README.zh-CN.md)

[![CI](https://github.com/TengYangTuoHai/dsh-session-harbor/actions/workflows/ci.yml/badge.svg)](https://github.com/TengYangTuoHai/dsh-session-harbor/actions/workflows/ci.yml)

Manage local sessions and sessions on multiple SSH devices from one DeepSeek Harness window. The sidebar groups sessions into Pinned, Active, Working, and Settled. Select a remote session to continue it in the main area.

[Install](#install) · [Connect SSH devices](#connect-ssh-devices) · [Releases](https://github.com/TengYangTuoHai/dsh-session-harbor/releases/latest) · [Report an issue](https://github.com/TengYangTuoHai/dsh-session-harbor/issues/new?template=bug-report.yml)

![Session Harbor groups local and SSH sessions in the DeepSeek Harness sidebar, with the selected conversation on the right](docs/session-harbor.png)

*Screenshot of the running app with sample sessions and devices.*

## Install

**Plugin v0.2.10** supports DeepSeek Harness `0.2.2-rc.3` and `0.2.2-rc.5`.

1. Open **Plugins** in the DSH sidebar and select **Add plugin**.
2. Enter the package name under **Package name or address**, then select **Install**.

   ```text
   dsh-session-harbor
   ```

3. Once installation finishes, select **Enable now**. If prompted, restart DSH and reopen the workbench.

If your registry mirror has yet to sync, choose **Registry → Custom address**, enter `https://registry.npmjs.org/`, and install by package name. You can also paste the GitHub Release `.tgz` download URL into the package field. [npm package](https://www.npmjs.com/package/dsh-session-harbor) · [Release downloads](https://github.com/TengYangTuoHai/dsh-session-harbor/releases/latest)

If you're upgrading from T3 Session Sidebar, uninstall it from **Plugins** before installing Session Harbor. Your sessions, pins, settled state, and saved SSH hosts carry over.

To update Session Harbor, select **Update** in the plugin details. If you installed from a `.tgz` and DSH offers no update, uninstall the package and reinstall it by name.

## Manage sessions

- **Switch sessions.** Select a local or SSH session to continue the conversation. The device name appears in the upper right of remote sessions.
- **See what needs your attention.** Sessions awaiting approval or an answer appear at the top of Active. Expand Working to see running tasks.
- **Organize sessions.** Right-click to pin, rename, or mark a session as settled. A new session appears in the list after its first turn begins.

Select **Use native** at the bottom of the sidebar to switch back to the built-in DSH list.

## Connect SSH devices

1. Go to **Settings → Session Harbor SSH**, select **Add host**, and choose a host from your local SSH config or enter `user@host`.
2. Select **Add and connect**. The device's sessions appear in the sidebar once the connection is ready.
3. Select an existing session to continue it. **New session** opens the DSH composer in the last available device and project used to start a session in this browser. You can change the selection above the composer.

SSH uses your local OpenSSH configuration and SSH agent. **Opening a remote session requires the same DSH version on both devices.** Install Session Harbor on the remote device too if you want to mark remote sessions as settled from the local sidebar and sync that state.

If installation or connection fails, include your version information and steps to reproduce it. [Report an issue](https://github.com/TengYangTuoHai/dsh-session-harbor/issues/new?template=bug-report.yml)

## Interface languages

Session Harbor follows **Settings → General → Language** in DSH. It supports English, Simplified Chinese, Japanese, Spanish, French, German, Russian, and Brazilian Portuguese.

## Install from source

Run these commands from the repository root to install dependencies, build, and verify the plugin.

```sh
npm --prefix dsh-session-harbor ci
node tools/build-client.mjs
node tools/build-client.mjs --check
node --test dsh-session-harbor/*.test.js
```

In DSH, open **Add plugin**, enter the absolute path to `dsh-session-harbor/`, and enable it.

[Plugin documentation](dsh-session-harbor/README.md) · [Remote session design](docs/remote-aggregation-design.md) · [Release process](docs/releasing.md)

## License

Session Harbor is licensed under MIT. Sidebar grouping and session rows draw from T3 Code at `095611d1` (MIT, © T3 Tools Inc.). [License](LICENSE) · [T3 Code](https://github.com/pingdotgg/t3code/tree/095611d1)
