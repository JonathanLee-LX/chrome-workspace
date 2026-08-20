// 本地 HTTP 服务：REST API + 静态 Web UI
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveConfig, portOf } from '../core/config.js';
import * as store from '../core/store.js';
import * as detector from '../core/detector.js';
import * as launcher from '../core/launcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(__dirname, 'ui');

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON'), { statusCode: 400 });
  }
}

function serialize(ws) {
  return {
    id: ws.id,
    name: ws.name,
    dir: ws.dir,
    homepage: ws.homepage,
    debugPort: ws.debugPort,
    notes: ws.notes,
    createdAt: ws.createdAt,
    running: detector.isRunning(ws),
    pid: detector.runningPid(ws),
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://127.0.0.1');
    const parts = u.pathname.split('/').filter(Boolean);
    const method = req.method;
    const cfg = loadConfig();

    // ---- API ----
    if (parts[0] === 'api') {
      if (parts[1] === 'health' && method === 'GET' && parts.length === 2) {
        return sendJSON(res, 200, { ok: true, version: 1, port: portOf(cfg) });
      }

      if (parts[1] === 'workspaces') {
        // /api/workspaces
        if (parts.length === 2) {
          if (method === 'GET') {
            return sendJSON(res, 200, { workspaces: cfg.workspaces.map(serialize) });
          }
          if (method === 'POST') {
            const body = await readBody(req);
            const ws = store.addWorkspace(cfg, body);
            saveConfig(cfg);
            return sendJSON(res, 201, serialize(ws));
          }
          return sendJSON(res, 405, { error: 'method not allowed' });
        }

        // /api/workspaces/:name ...
        const name = decodeURIComponent(parts[2]);
        const ws = store.findByName(cfg, name);
        if (!ws) {
          return sendJSON(res, 404, { error: `工作区不存在: ${name}` });
        }

        if (parts.length === 3) {
          if (method === 'GET') return sendJSON(res, 200, serialize(ws));
          if (method === 'DELETE') {
            const purge = u.searchParams.get('purge') === '1';
            store.removeWorkspace(cfg, name);
            saveConfig(cfg);
            if (purge) fs.rmSync(ws.dir, { recursive: true, force: true });
            return sendJSON(res, 200, { ok: true, purged: purge });
          }
          return sendJSON(res, 405, { error: 'method not allowed' });
        }

        if (parts.length === 4) {
          const sub = parts[3];
          if (sub === 'open' && method === 'POST') {
            const body = await readBody(req);
            const wasRunning = detector.isRunning(ws);
            let pid = ws.lastPid;
            if (!wasRunning) {
              pid = launcher.launch(cfg, ws, body?.url);
              ws.lastPid = pid;
              saveConfig(cfg);
            } else {
              launcher.launch(cfg, ws, body?.url); // 仅开新页，信号进程随即退出
            }
            const resp = serialize(ws);
            if (!wasRunning) {
              resp.running = true; // 刚启动，锁文件可能还没落盘，乐观置为运行
              resp.pid = pid;
            }
            return sendJSON(res, 200, resp);
          }
          if (sub === 'close' && method === 'POST') {
            if (!detector.isRunning(ws)) {
              return sendJSON(res, 200, serialize(ws)); // 幂等
            }
            launcher.close(ws);
            return sendJSON(res, 200, serialize({ ...ws, lastPid: null }));
          }
        }
      }
      return sendJSON(res, 404, { error: 'not found' });
    }

    // ---- 静态 Web UI ----
    if (method === 'GET' && (parts.length === 0 || parts[0] === 'index.html')) {
      const file = fs.readFileSync(path.join(UI_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(file);
    }
    if (method === 'GET' && parts[0] === 'favicon.ico') {
      res.writeHead(204).end();
      return;
    }

    return sendJSON(res, 404, { error: 'not found' });
  } catch (err) {
    sendJSON(res, err.statusCode || 500, { error: err.message });
  }
});

const port = portOf(loadConfig());
server.listen(port, '127.0.0.1', () => {
  console.log(`[chrome-ws] 服务已启动: http://127.0.0.1:${port}`);
});
