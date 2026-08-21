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

export function renameWorkspace(cfg, name, newName) {
  const ws = findByName(cfg, name);
  if (!ws) {
    throw Object.assign(new Error(`工作区不存在: ${name}`), { statusCode: 404 });
  }
  const target = String(newName ?? '').trim();
  if (!NAME_RE.test(target)) {
    throw new Error(`工作区名称不合法: "${target}"（仅允许字母/数字/-/_，最长64位）`);
  }
  if (target === ws.name) return ws;
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
  return ws;
}
