#!/usr/bin/env node
// chrome-ws CLI：管理本地服务 + 通过 HTTP 操作工作区
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadConfig, saveConfig, portOf, SERVER_PID, SERVER_LOG, ROOT_DIR,
} from '../core/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = path.join(__dirname, '..', 'server', 'server.js');

const HELP = `
Chrome 工作区管理器 (chrome-ws) v0.1.0

用法:
  chrome-ws server start|stop|status|restart   管理本地服务
  chrome-ws add <name> [--homepage url] [--debug-port n] [--notes "..."]
  chrome-ws import <name> [options]             导入继承现有 Chrome 配置
      --from <path|default>   源 user-data-dir / profile 目录（缺省: 系统默认 Chrome）
      --profile <name>        源内具体 profile（缺省: Default）
      --with-cache            连同可再生缓存一起复制（体积大，缺省排除）
      --no-extensions         跳过 Extensions 目录（可省大量空间）
      --force                 源 Chrome 正在运行时强制导入
      --homepage url / --notes "..."
  chrome-ws profiles [--from <path|default>]   列出源中可用 profile
  chrome-ws list                               列出全部工作区
  chrome-ws show <name>                        查看单个工作区
  chrome-ws open <name> [url]                  打开工作区（url 缺省用 homepage）
  chrome-ws close <name> | close --all         关闭工作区
  chrome-ws rm <name> [--purge]                删除工作区（--purge 同时删数据目录）
  chrome-ws --help | --version
`.trim();

const C = {
  green: '\x1b[32m', red: '\x1b[31m', gray: '\x1b[90m', reset: '\x1b[0m', bold: '\x1b[1m',
};

// ---------- server 管理 ----------

function readPid() {
  try { return Number(fs.readFileSync(SERVER_PID, 'utf8').trim()); } catch { return null; }
}
function isServerRunning() {
  const pid = readPid();
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function serverStart() {
  if (isServerRunning()) {
    console.log(`服务已在运行 (pid=${readPid()})，Web UI: http://127.0.0.1:${portOf(loadConfig())}`);
    return;
  }
  fs.mkdirSync(ROOT_DIR, { recursive: true });
  const log = fs.openSync(SERVER_LOG, 'a');
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    detached: true, stdio: ['ignore', log, log],
  });
  fs.writeFileSync(SERVER_PID, String(child.pid));
  child.unref();
  console.log(`服务已后台启动 (pid=${child.pid})`);
  console.log(`  Web UI: http://127.0.0.1:${portOf(loadConfig())}`);
  console.log(`  日志:   ${SERVER_LOG}`);
}
function serverStop() {
  const pid = readPid();
  if (!pid || !isServerRunning()) {
    console.log('服务未在运行');
    return;
  }
  try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
  fs.rmSync(SERVER_PID, { force: true });
  console.log(`服务已停止 (pid=${pid})`);
}
function serverStatus() {
  const running = isServerRunning();
  console.log(running
    ? `${C.green}● 运行中${C.reset} pid=${readPid()}  http://127.0.0.1:${portOf(loadConfig())}`
    : `${C.gray}○ 未运行${C.reset}  执行 ${C.bold}chrome-ws server start${C.reset} 启动`);
}
function serverRestart() { serverStop(); serverStart(); }

// ---------- HTTP 客户端 ----------

async function api(method, pathname, body) {
  const port = portOf(loadConfig());
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    console.error(`${C.red}✗ 无法连接本地服务，请先执行:${C.reset} ${C.bold}chrome-ws server start${C.reset}`);
    process.exit(1);
  }
  const data = await res.json();
  if (!res.ok) {
    console.error(`${C.red}✗ ${data.error || `HTTP ${res.status}`}${C.reset}`);
    process.exit(1);
  }
  return data;
}

// ---------- 展示 ----------

function printWorkspaces(list) {
  if (!list.length) {
    console.log(`${C.gray}(暂无工作区，用 chrome-ws add <name> 创建)${C.reset}`);
    return;
  }
  const nameW = Math.max(4, ...list.map((w) => w.name.length));
  const row = (w) => {
    const status = w.running
      ? `${C.green}● 运行${C.reset}`
      : `${C.gray}○ 停止${C.reset}`;
    const pid = w.running && w.pid ? String(w.pid) : '-';
    const home = w.homepage || '-';
    const note = w.notes || '';
    const name = w.running ? `${C.bold}${w.name}${C.reset}` : w.name;
    return `  ${name.padEnd(nameW + 2)} ${status}  ${pid.padEnd(7)} ${home}  ${C.gray}${note}${C.reset}`;
  };
  console.log(`  ${'名称'.padEnd(nameW + 2)} 状态     PID    首页                             备注`);
  console.log('  ' + '-'.repeat(74));
  list.forEach((w) => console.log(row(w)));
}

// ---------- 参数解析 ----------

function parseOpts(args, { number = [], bool = [] } = {}) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (bool.includes(key)) { out[key] = true; continue; }
      if (number.includes(key)) out[key] = Number(args[++i]);
      else out[key] = args[++i];
    } else {
      out._.push(a);
    }
  }
  return out;
}

function formatBytes(n) {
  if (n == null) return '-';
  if (n < 1024) return `${n}B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)}MB`;
  return `${(n / 1024 ** 3).toFixed(2)}GB`;
}

// ---------- 命令分发 ----------

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      console.log(HELP); return;

    case '-v':
    case '--version': {
      const { version } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
      console.log(version); return;
    }

    case 'server': {
      const sub = rest[0] || 'status';
      if (sub === 'start') return serverStart();
      if (sub === 'stop') return serverStop();
      if (sub === 'status') return serverStatus();
      if (sub === 'restart') return serverRestart();
      console.error(`未知子命令: server ${sub}\n\n${HELP}`);
      process.exit(1);
    }

    case 'add': {
      const o = parseOpts(rest, { number: ['debug-port'] });
      const name = o._[0];
      if (!name) { console.error('用法: chrome-ws add <name> [--homepage url] [--debug-port n]'); process.exit(1); }
      const ws = await api('POST', '/api/workspaces', {
        name,
        homepage: o.homepage,
        debugPort: o['debug-port'],
        notes: o.notes,
      });
      console.log(`${C.green}✔ 已创建工作区:${C.reset} ${C.bold}${ws.name}${C.reset}`);
      console.log(`  目录: ${ws.dir}`);
      if (ws.homepage) console.log(`  首页: ${ws.homepage}`);
      return;
    }

    case 'import': {
      const o = parseOpts(rest, { bool: ['with-cache', 'no-extensions', 'force'] });
      const name = o._[0];
      if (!name) { console.error('用法: chrome-ws import <name> [--from path] [--profile p] [--with-cache] [--no-extensions] [--force]'); process.exit(1); }
      console.log('正在分析源与复制数据，请稍候…');
      const { workspace, import: imp } = await api('POST', '/api/workspaces/import', {
        name,
        source: o.from,
        profile: o.profile,
        withCache: o['with-cache'],
        withExtensions: !o['no-extensions'],
        force: o.force,
        homepage: o.homepage,
        notes: o.notes,
      });
      console.log(`${C.green}✔ 已导入工作区:${C.reset} ${C.bold}${workspace.name}${C.reset}`);
      console.log(`  来源: ${imp.profile}  (${imp.sourceDir})`);
      console.log(`  复制: ${formatBytes(imp.bytesCopied)} / ${imp.filesCopied} 个文件`);
      console.log(`  目录: ${workspace.dir}`);
      console.log(`  下一步: ${C.bold}chrome-ws open ${workspace.name}${C.reset}`);
      return;
    }

    case 'profiles': {
      const o = parseOpts(rest);
      const from = o.from || 'default';
      const { sourceDir, profiles } = await api('GET', `/api/import/profiles?from=${encodeURIComponent(from)}`);
      console.log(`源: ${sourceDir}`);
      if (!profiles.length) { console.log('（源中没有任何可用 profile）'); return; }
      for (const p of profiles) {
        const tag = p.isDefault ? ' *' : '';
        console.log(`  ${p.name.padEnd(16)} ${(p.displayName || '').padEnd(12)} ${(p.user || '').padEnd(24)} ${p.path}${tag}`);
      }
      console.log('(* = 默认 profile)');
      return;
    }

    case 'list': {
      const { workspaces } = await api('GET', '/api/workspaces');
      printWorkspaces(workspaces);
      return;
    }

    case 'show': {
      const name = rest[0];
      if (!name) { console.error('用法: chrome-ws show <name>'); process.exit(1); }
      const ws = await api('GET', `/api/workspaces/${encodeURIComponent(name)}`);
      console.log(`${C.bold}${ws.name}${C.reset}  ${ws.running ? `${C.green}● 运行${C.reset}` : `${C.gray}○ 停止${C.reset}`}`);
      for (const [k, v] of Object.entries(ws)) {
        if (['id', 'name', 'running'].includes(k)) continue;
        if (v === null || v === '' || v === false) continue;
        console.log(`  ${k}: ${v}`);
      }
      return;
    }

    case 'open': {
      const o = parseOpts(rest);
      const name = o._[0];
      if (!name) { console.error('用法: chrome-ws open <name> [url]'); process.exit(1); }
      const ws = await api('POST', `/api/workspaces/${encodeURIComponent(name)}/open`, { url: o._[1] });
      console.log(`${C.green}✔ 已打开${C.reset} ${C.bold}${ws.name}${C.reset}${ws.running ? ` (pid=${ws.pid})` : ''}`);
      return;
    }

    case 'close': {
      if (rest[0] === '--all') {
        const { workspaces } = await api('GET', '/api/workspaces');
        const running = workspaces.filter((w) => w.running);
        if (!running.length) { console.log('没有运行中的工作区'); return; }
        for (const w of running) {
          await api('POST', `/api/workspaces/${encodeURIComponent(w.name)}/close`);
          console.log(`${C.green}✔ 已关闭${C.reset} ${w.name}`);
        }
        return;
      }
      const name = rest[0];
      if (!name) { console.error('用法: chrome-ws close <name> | chrome-ws close --all'); process.exit(1); }
      await api('POST', `/api/workspaces/${encodeURIComponent(name)}/close`);
      console.log(`${C.green}✔ 已关闭${C.reset} ${name}`);
      return;
    }

    case 'rm': {
      const o = parseOpts(rest);
      const name = o._[0];
      if (!name) { console.error('用法: chrome-ws rm <name> [--purge]'); process.exit(1); }
      const { purged } = await api('DELETE', `/api/workspaces/${encodeURIComponent(name)}?purge=${o.purge ? 1 : 0}`);
      console.log(`${C.green}✔ 已删除工作区:${C.reset} ${name}${purged ? '（含数据目录）' : ''}`);
      return;
    }

    default:
      console.error(`未知命令: ${cmd}\n\n${HELP}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`${C.red}✗ ${err.message}${C.reset}`);
  process.exit(1);
});
