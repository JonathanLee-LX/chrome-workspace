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

## 导入继承现有 Chrome 配置

把现有的 Chrome profile（书签 / 密码 / cookies / 扩展 / 历史）整体复制成新工作区，
新工作区启动即拥有全套配置：

```bash
chrome-ws profiles                # 查看源中有哪些 profile
chrome-ws import work --from default --profile Default
```

```
chrome-ws import <name> [options]             导入继承现有 Chrome 配置
    --from <path|default>   源 user-data-dir / profile 目录（缺省: 系统默认 Chrome）
    --profile <name>        源内具体 profile（缺省: Default）
    --with-cache            连同可再生缓存一起复制（体积大，缺省排除）
    --no-extensions         跳过 Extensions 目录（可省大量空间，1G+ 常见）
    --force                 源 Chrome 正在运行时强制导入
    --homepage url / --notes "..."
chrome-ws profiles [--from <path|default>]   列出源中可用 profile
```

> ⚠️ 导入前请先**退出源 Chrome**。默认会排除可再生缓存（Cache / GPUCache / CacheStorage 等），
> 保留书签 / cookies / 密码 / 历史 / 扩展等用户数据；同机导入 cookies 与密码仍可正常解密
> （依赖 macOS 登录钥匙串中的 `Chrome Safe Storage`）。


## 命令一览

```
chrome-ws server start|stop|status|restart   管理本地服务
chrome-ws add <name> [--homepage url] [--debug-port n] [--notes "..."]
chrome-ws import <name> [--from path] [--profile p] [--with-cache] [--no-extensions] [--force]
chrome-ws profiles [--from <path|default>]
chrome-ws list
chrome-ws show <name>
chrome-ws open <name> [url]
chrome-ws close <name> | close --all
chrome-ws rename <old> <new>                 改名（需先关闭，数据目录随迁）
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

导入功能把源 profile 复制到工作区的 `user-data-dir/Default`（Chrome 会自行重新生成
`Local State` 等目录级文件），复制时按白名单保留用户数据、按黑名单排除可再生缓存。

详见 [DESIGN.md](DESIGN.md)。
