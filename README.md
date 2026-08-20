# chrome-ws — Chrome 工作区管理器

通过 `--user-data-dir` 管理多套 Chrome 配置，让多个 Chrome 实例**并行运行、互不冲突**
（独立 cookies / 扩展 / 历史 / 书签）。

架构：本地 HTTP 服务（B/S）+ Web UI + CLI 接口，Node.js 零依赖，macOS。

## 安装

```bash
cd chrome-ws
npm link          # 把 chrome-ws 命令装到全局（可选）
```

## 快速开始

```bash
chrome-ws server start                       # 1. 启动本地服务（后台守护）
open http://127.0.0.1:8736                   # 2. 打开 Web UI
# 或使用 CLI：
chrome-ws add work --homepage https://mail.example.com
chrome-ws open work
chrome-ws list
chrome-ws close work
chrome-ws rm work --purge
```

## 命令一览

```
chrome-ws server start|stop|status|restart   管理本地服务
chrome-ws add <name> [--homepage url] [--debug-port n] [--notes "..."]
chrome-ws list
chrome-ws show <name>
chrome-ws open <name> [url]
chrome-ws close <name> | close --all
chrome-ws rm <name> [--purge]
```

## 数据位置

- 配置与工作区清单：`~/.chrome-ws/config.json`
- 各工作区 user-data-dir：`~/.chrome-ws/data/<name>`
- 服务日志 / PID：`~/.chrome-ws/server.log` / `~/.chrome-ws/server.pid`

## 工作原理

每个工作区对应一份独立 `--user-data-dir`，Chrome 以完全独立的进程运行。
运行状态通过目录下的 `SingletonLock` 锁文件检测；关闭时对主进程发 `SIGTERM`，
失败则 `pkill` 兜底。

详见 [DESIGN.md](DESIGN.md)。
