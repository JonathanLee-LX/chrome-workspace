// 全局配置与路径管理
import { homedir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export const ROOT_DIR = path.join(homedir(), '.chrome-ws');
export const CONFIG_FILE = path.join(ROOT_DIR, 'config.json');
export const DATA_ROOT = path.join(ROOT_DIR, 'data');
export const SERVER_LOG = path.join(ROOT_DIR, 'server.log');
export const SERVER_PID = path.join(ROOT_DIR, 'server.pid');

export const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const DEFAULTS = {
  version: 1,
  port: 8736,
  chromeBin: DEFAULT_CHROME,
  workspaces: [],
};

export function ensureRoot() {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
}

export function loadConfig() {
  ensureRoot();
  if (!fs.existsSync(CONFIG_FILE)) {
    const cfg = structuredClone(DEFAULTS);
    saveConfig(cfg);
    return cfg;
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

export function saveConfig(cfg) {
  ensureRoot();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

/** 某个工作区对应的 user-data-dir */
export function wsDir(name) {
  return path.join(DATA_ROOT, name);
}

export function portOf(cfg) {
  return cfg.port || DEFAULTS.port;
}
