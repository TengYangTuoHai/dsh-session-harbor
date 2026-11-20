# Session Harbor

English · [简体中文](https://github.com/TengYangTuoHai/dsh-session-harbor/blob/main/dsh-session-harbor/README.zh-CN.md)

Session Harbor brings local and SSH sessions into one workbench, grouped under Pinned, Active, Working, and Settled. Select a remote row to open that device's native session view in the main area. The local sidebar and shell stay in place. When starting a session, choose a device first, then a project on that device.

## Usage

- Open **Settings → Session Harbor SSH** and choose a host from your local SSH config or enter `user@host`. You can reconnect, disconnect, and remove saved devices here. SSH authentication uses your local OpenSSH config and SSH agent. The remote device needs DSH installed.
- Switch between local and remote sessions in the same list. Both support collapsing groups, opening a session by clicking anywhere in its row, and keyboard navigation. The time appears to the right of the session title. Remote sessions show the host name in the upper right.
- Selecting a device prepares the project picker. Selecting a project creates or reuses an empty session on that device and opens it.
- **Add workspace** uses the same two-column folder picker for local and SSH devices. Navigate with breadcrumbs or enter a path directly. You can show hidden folders and create a folder on the selected device.
- Each device runs its own official DSH Client runtime for the native conversation, composer, model picker, attachments, approvals, and questions. The interface follows the local workbench language, and session actions go to the device that owns the session.
- Pins use the owning device's DSH state, and settled sessions use its plugin state. Ordinary sessions awaiting approval or an answer appear at the top of Active, with a pending count in the group header. After a run finishes, the session remains in Working for two seconds before returning to Active. Pinned and Settled take priority over Working.
- The session menu offers Open, Pin, Settle, Rename, Fork session, Copy session ID, and Archive. Actions that write changes are disabled while the device is offline. Project management has a separate entry point.
- Pinned and Active sit at the top of the list, with Working and Settled at the bottom. Pinned appears when it contains visible sessions. Groups collapse and scroll independently when they have many rows. Working opens automatically when its first session appears, and Settled starts collapsed. The sidebar uses the host's light and dark theme variables, and status icons stop spinning when reduced motion is enabled. **Use native** switches back to the built-in sidebar.

## Versions and dependencies

The earlier T3 Session Sidebar used a different package name. Uninstall it in DSH's plugin manager before installing Session Harbor. Existing sessions, pins, settled state, and SSH host settings carry over.

Version `0.2.8` supports DSH `0.2.2-rc.3` and `0.2.2-rc.5`. The workbench initializes remote clients in the background for ready SSH connections and reuses them when switching sessions. The sidebar fills the space below the host navigation. The entire list scrolls when space is limited. An active remote session receives its own shortcuts while the local window handles the left sidebar.

At startup, the plugin connects to devices saved in **Settings → Session Harbor SSH**. The sidebar keeps the last sync for each device and clears that cache when you remove it. Marking a session as settled or reactivating it syncs between Session Harbor instances that use the same DSH data directory on the session's device. After upgrading, restart DSH on that device and reconnect SSH so both processes load the update. The native remote session view requires matching DSH versions on both devices.

On a first remote installation, existing ordinary sessions that are nonempty, unarchived, and idle are migrated to Settled once. Existing migration records are preserved. Pinning and settling span two storage services. After a failure, the plugin rereads the actual state. If the remote device creates a session but the response is lost, a retry across connections cannot guarantee distributed exactly-once creation.

## Build and verification

Run these commands from the repository root.

```sh
npm --prefix dsh-session-harbor ci
node tools/build-client.mjs
node tools/build-client.mjs --check
node --test dsh-session-harbor/*.test.js
```

The build generates `client.remote-runtime.js` in the package. Tests cover connection generations, protocol handling, authenticated resource routing, storage isolation, state merging, creation idempotency, navigation lifecycle, and shortcut ownership. The old jsdom row script is retired because it treated a remote click with no visible effect as a pass.

A read-only probe on Desktop `0.2.2-rc.5` loaded one existing session on each of `wsl` and `2060`. It confirmed that each native conversation and editable composer mounted. Send routing was checked with the official client and an isolated transport. Sending a real remote message, handling approvals and attachments, and reviewing the right panel still require hands-on verification.

When updating a loaded local Host module, follow the plugin manager's restart prompt. Use Client Inspect to confirm that the connected workbench has registered the plugin entries.

See the [remote session design](../docs/remote-aggregation-design.md) for the full design and acceptance criteria.

## License

Sidebar grouping and session rows draw from T3 Code at `095611d1` (MIT, © T3 Tools Inc.). This repository uses the MIT license. DSH native components load at runtime from trusted official resources in the installation. [T3 Code](https://github.com/pingdotgg/t3code/tree/095611d1)
