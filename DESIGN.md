# Chrome 工作区管理器（chrome-ws）— 设计文档

## 1. 背景与原理

Chrome 单机只允许**同一份 user-data-dir 同时被一个进程占用**。默认所有窗口共享
`~/Library/Application Support/Google/Chrome` 这一份配置，因此多开窗口不隔离。

通过 `--user-data-dir=<绝对路径>` 可以让每个 Chrome 实例使用**完全独立的一份配置**
（独立 cookies / 扩展 / 历史 / 书签），多个实例可并行运行、互不干扰。

```
默认 Chrome ──> ~/Library/Application Support/Google/Chrome   （唯一，共享）
chrome-ws   ──> ~/.chrome-ws/data/work        ┐
             ─> ~/.chrome-ws/data/personal     ├─ 每个工作区一份独立配置，并行
             ─> ~/.chrome-ws/data/dev         ┘
```

> 关键认知：Chrome 扩展无法实现此功能（扩展只能运行在自己的 profile 内，不能控制别的实例）。
> 因此管理器必须是**外部进程** —— 本项目采用 B/S 架构。

## 2. 技术决策（已确认）

| # | 决策 | 结论 |
|---|------|------|
| 1 | 架构 | B/S：本地 HTTP 服务 + Web UI，同时提供 CLI 接口 |
| 2 | 语言 | Node.js（≥18，零第三方依赖，用内置 http/fetch/child_process） |
| 3 | 平台 | macOS（Chrome 二进制路径按 macOS 写死，Windows 预留抽象） |
| 4 | 存储 | JSON 文件（`~/.chrome-ws/config.json`，含工作区清单 + 服务配置） |
| 5 | 范围 | MVP：增删查、启停、状态检测、Web UI |

## 3. 架构

```
┌────────────────────────────┐     HTTP(127.0.0.1:8736)     ┌──────────────────────┐
│  CLI  (chrome-ws)          │ ───────────────────────────► │  本地服务 server.js   │
│  add/list/open/close/rm    │                               │  - REST API          │
│  server start/stop/status  │ ◄─────────────────────────── │  - 静态 Web UI       │
└────────────────────────────┘                               └──────────┬───────────┘
        Web UI（浏览器打开 :8736）                                        │ spawn/kill
                                                                        ▼
                                                          Chrome 实例（每个工作区一个）
```

- **服务端是唯一数据源**：CLI 与 Web UI 都通过 HTTP 访问服务端，保持一致。
- 服务端绑定 `127.0.0.1`，仅本机可访问。
- CLI 的 `server start` 将服务端作为后台守护进程拉起（pid 文件 + 日志文件）。

## 4. 数据模型（~/.chrome-ws/config.json）

```json
{
  "version": 1,
  "port": 8736,
  "chromeBin": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "workspaces": [
    {
      "id": "uuid",
      "name": "work",
      "dir": "/Users/me/.chrome-ws/data/work",
      "homepage": "https://mail.example.com",
      "debugPort": null,
      "notes": "",
      "lastPid": 12345,
      "createdAt": "2026-04-27T..."
    }
  ]
}
```

- `lastPid`：最近一次由本工具拉起的主进程 PID（用于 `close` 优雅退出）。
- `debugPort`：非空时为该工作区加 `--remote-debugging-port`，方便自动化/调试。

## 5. REST API

| Method | Path | 说明 |
|--------|------|------|
| GET  | `/api/health` | 健康检查 |
| GET  | `/api/workspaces` | 列表（含运行状态） |
| POST | `/api/workspaces` | 创建 `{name, homepage?, debugPort?, notes?}` |
| GET  | `/api/workspaces/:name` | 详情 |
| PATCH | `/api/workspaces/:name` | 编辑属性 `{name?, homepage?, debugPort?, notes?}`（改 name 需先关闭、数据目录随迁、运行中 409；homepage/debugPort/notes 运行中可改，空值清除） |
| POST | `/api/workspaces/:name/open` | 打开 `{url?}`（未运行则启动；已运行仅开新页） |
| POST | `/api/workspaces/:name/close` | 关闭（幂等） |
| DELETE | `/api/workspaces/:name?purge=1` | 删除（`purge=1` 同时删数据目录） |
| GET  | `/api/import/profiles?from=<path>` | 列出源中的可用 profile |
| POST | `/api/workspaces/import` | 导入继承现有配置 `{name, source?, profile?, withCache?, withExtensions?, force?, homepage?, notes?}` |
| GET  | `/` | Web UI |

### 导入（`core/importer.js`）

把源 profile 复制到新工作区的 `user-data-dir/Default`，Chrome 自行重建 `Local State` 等
目录级文件。源解析顺序：`--from` 省略/`default` → 系统默认 Chrome；直接指向 profile 目录
（含 `Preferences`/`Bookmarks` 等标记）→ 用之；指向 user-data-dir → 按 `--profile` 选择。

**排除规则**（默认）：运行锁（`SingletonLock`/`SingletonSocket`/`SingletonCookie`/`lockfile`）
与可再生缓存（`Cache`/`Code Cache`/`GPUCache`/`CacheStorage`/`blob_storage`/`Crashpad` 等）。
保留用户数据：书签、cookies、密码、历史、IndexedDB、Local Storage、File System、扩展。
`--with-cache` 保留缓存；`--no-extensions` 跳过体积大户 Extensions。

**运行源保护**：源 user-data-dir 根目录存在锁文件（Chrome 正在运行）时默认拒绝（409），
提示先退出源 Chrome，或 `--force` 强制。

**同机 cookie/密码可解密**：Chrome 的 cookie/密码加密密钥在 macOS 登录钥匙串
（`Chrome Safe Storage`）中，与 user-data-dir 无关，因此同机导入后仍能正常解密。

## 6. CLI 命令

```
chrome-ws server start|stop|status|restart   管理本地服务
chrome-ws add <name> [--homepage url] [--debug-port n] [--notes "..."]
chrome-ws list                               列出全部工作区（含状态）
chrome-ws show <name>
chrome-ws open <name> [url]                  url 缺省用 homepage
chrome-ws close <name> | close --all
chrome-ws rename <old> <new>                  改名（需先关闭；数据目录随迁）
chrome-ws edit <name> [--name 新名] [--homepage url] [--debug-port n] [--notes "..."]
                                            编辑属性（空值清除字段；改 name 需先关闭）
chrome-ws rm <name> [--purge]
```

## 7. 运行状态检测

两级判断（`core/detector.js`）：
1. 工作区目录下存在 `SingletonLock` ⇒ 运行中（Chrome 官方锁文件，最可靠）
2. 记录的 `lastPid` 仍存活 ⇒ 运行中（兜底）

关闭策略（`core/launcher.js`）：优先对 `lastPid` 发 `SIGTERM`（优雅退出），失败则
`pkill -f "user-data-dir=<dir>"` 兜底。

## 8. 目录结构

```
chrome-ws/
├── package.json
├── DESIGN.md
├── README.md
├── src/
│   ├── cli/index.js         # CLI 入口（HTTP 客户端 + server 管理）
│   ├── core/
│   │   ├── config.js        # 路径 / 配置加载保存
│   │   ├── store.js         # 工作区 CRUD + 名称校验
│   │   ├── launcher.js      # Chrome 启停
│   │   ├── detector.js      # 运行状态检测
│   │   └── importer.js      # 导入继承现有配置（源解析 + 排除拷贝）
│   └── server/
│       ├── server.js        # HTTP 服务 + 路由
│       └── ui/index.html    # Web UI（零构建）
└── test/
```

## 9. Roadmap

- **已做**：MVP（B/S + CLI + Web UI + 启停/状态检测）、导入继承现有配置
- **v1.5**：工作区图标/颜色、启动参数模板、菜单栏常驻、跨 profile 多开
- **v2**：备份/还原、工作区导出、Windows 支持、自动巡检锁文件清理
