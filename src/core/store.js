// 工作区元数据 CRUD（作用于 config.json 中的 workspaces 数组）
import crypto from 'node:crypto';
import fs from 'node:fs';
import { wsDir } from './config.js';

export const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export function findByName(cfg, name) {
  return cfg.workspaces.find((w) => w.name === name) || null;
}

export function addWorkspace(cfg, input) {
  const name = String(input?.name ?? '').trim();
  if (!NAME_RE.test(name)) {
    throw new Error(`工作区名称不合法: "${name}"（仅允许字母/数字/-/_，最长64位）`);
  }
  if (findByName(cfg, name)) {
    throw new Error(`工作区已存在: ${name}`);
  }

  const ws = {
    id: crypto.randomUUID(),
    name,
    dir: wsDir(name),
    homepage: input?.homepage || null,
    debugPort: input?.debugPort ? Number(input.debugPort) : null,
    notes: input?.notes || '',
    lastPid: null,
    createdAt: new Date().toISOString(),
  };
  fs.mkdirSync(ws.dir, { recursive: true });
  cfg.workspaces.push(ws);
  return ws;
}

export function removeWorkspace(cfg, name) {
  const idx = cfg.workspaces.findIndex((w) => w.name === name);
  if (idx < 0) {
    throw Object.assign(new Error(`工作区不存在: ${name}`), { statusCode: 404 });
  }
  const [ws] = cfg.workspaces.splice(idx, 1);
  return ws;
}

export function updateWorkspace(cfg, name, patch = {}) {
  const ws = findByName(cfg, name);
  if (!ws) {
    throw Object.assign(new Error(`工作区不存在: ${name}`), { statusCode: 404 });
  }

  // 名称：合法 + 不重名 + 数据目录随迁
  if (patch.name !== undefined) {
    const target = String(patch.name ?? '').trim();
    if (!NAME_RE.test(target)) {
      throw new Error(`工作区名称不合法: "${target}"（仅允许字母/数字/-/_，最长64位）`);
    }
    if (target !== ws.name) {
      if (findByName(cfg, target)) {
        throw Object.assign(new Error(`工作区已存在: ${target}`), { statusCode: 409 });
      }
      const oldDir = ws.dir;
      const newDir = wsDir(target);
      if (fs.existsSync(oldDir) && oldDir !== newDir) {
        fs.renameSync(oldDir, newDir);
      }
      ws.name = target;
      ws.dir = newDir;
    }
  }

  // 首页：空串/空白 → null
  if (patch.homepage !== undefined) {
    const h = patch.homepage == null ? null : String(patch.homepage).trim() || null;
    ws.homepage = h;
  }

  // 调试端口：空/undefined → null；否则 1-65535 整数
  if (patch.debugPort !== undefined) {
    if (patch.debugPort === null || patch.debugPort === '') {
      ws.debugPort = null;
    } else {
      const p = Number(patch.debugPort);
      if (!Number.isInteger(p) || p < 1 || p > 65535) {
        throw new Error(`调试端口不合法: ${patch.debugPort}（应为 1-65535 的整数）`);
      }
      ws.debugPort = p;
    }
  }

  // 备注：字符串
  if (patch.notes !== undefined) {
    ws.notes = patch.notes == null ? '' : String(patch.notes);
  }

  return ws;
}
