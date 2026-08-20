// 导入/继承现有 Chrome 配置
// - 源：默认 `~/Library/Application Support/Google/Chrome`（或 --from 指定 user-data-dir / profile 目录）
// - 目标：把选中的 profile 复制到工作区的 user-data-dir 下作为 Default
// - 默认排除：运行锁 + 可再生缓存（Cache / Code Cache / GPUCache / CacheStorage 等），保留用户数据
import { homedir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { cp, readdir, stat } from 'node:fs/promises';

export const DEFAULT_SOURCE = path.join(
  homedir(), 'Library', 'Application Support', 'Google', 'Chrome',
);

/** 判定"这是一个 profile 目录"的标志文件 */
const PROFILE_MARKERS = ['Preferences', 'Bookmarks', 'Cookies', 'History', 'Web Data'];

/** 默认排除：运行锁 + 可再生缓存（这些 Chrome 会重新生成，且往往体积巨大） */
const DEFAULT_EXCLUDE = new Set([
  'SingletonLock', 'SingletonSocket', 'SingletonCookie',
  'Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
  'GraphiteDawnCache', 'ShaderCache', 'GrShaderCache',
  'CacheStorage', 'blob_storage', 'Crashpad', 'BrowserMetrics', 'Shared Dictionary',
]);

function looksLikeProfile(dir) {
  return PROFILE_MARKERS.some((m) => fs.existsSync(path.join(dir, m)));
}

/** 跨平台判断源 Chrome 是否正在运行（锁文件位于 user-data-dir 根目录） */
export function isSourceRunning(sourceDir) {
  return ['SingletonLock', 'SingletonSocket', 'SingletonCookie', 'lockfile']
    .some((f) => fs.existsSync(path.join(sourceDir, f)));
}

/** 读取 Local State 中的 profile 展示信息 */
function readInfoCache(userDataDir) {
  try {
    const localState = JSON.parse(
      fs.readFileSync(path.join(userDataDir, 'Local State'), 'utf8'),
    );
    return localState.profile?.info_cache || {};
  } catch {
    return {};
  }
}

/** 列出源 user-data-dir 下的可用 profile */
export function listProfiles(sourceDir) {
  const infoCache = readInfoCache(sourceDir);
  const dirs = fs.readdirSync(sourceDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .filter((d) => looksLikeProfile(path.join(sourceDir, d.name)));
  return dirs
    .map((d) => ({
      name: d.name,
      path: path.join(sourceDir, d.name),
      displayName: infoCache[d.name]?.name || d.name,
      user: infoCache[d.name]?.user_name || null,
      isDefault: d.name === 'Default',
    }))
    .sort((a, b) => (a.isDefault ? -1 : 1) - (b.isDefault ? -1 : 1) || a.name.localeCompare(b.name));
}

/**
 * 解析导入源。返回 { sourceDir, profileDir, profileName }。
 * - from 省略或 'default' → 系统默认 Chrome
 * - from 直接指向一个 profile 目录（含 Preferences/Bookmarks 等）→ 用之
 * - from 指向 user-data-dir → 配合 --profile 选 profile（缺省 Default）
 */
export function resolveSource({ from, profile } = {}) {
  let sourceDir = from && from !== 'default' ? path.resolve(from) : DEFAULT_SOURCE;
  if (!fs.existsSync(sourceDir)) {
    throw Object.assign(new Error(`源目录不存在: ${sourceDir}`), { statusCode: 404 });
  }

  // 情况1：直接指向 profile 目录
  if (looksLikeProfile(sourceDir)) {
    return {
      sourceDir: path.dirname(sourceDir),
      profileDir: sourceDir,
      profileName: path.basename(sourceDir),
    };
  }

  // 情况2：user-data-dir，选择 profile
  const profiles = listProfiles(sourceDir);
  if (!profiles.length) {
    throw Object.assign(new Error(`源目录中没有可用 profile: ${sourceDir}`), { statusCode: 404 });
  }
  const target = profile || 'Default';
  const hit = profiles.find((p) => p.name === target);
  if (!hit) {
    const avail = profiles.map((p) => p.name).join(', ');
    throw Object.assign(new Error(`源中找不到 profile "${target}"，可用: ${avail}`), { statusCode: 404 });
  }
  return { sourceDir, profileDir: hit.path, profileName: hit.name };
}

function makeSkip({ withCache = false, withExtensions = true }) {
  return (p) => {
    const base = path.basename(p);
    if (base === 'Extensions' && !withExtensions) return true;
    if (!withCache && DEFAULT_EXCLUDE.has(base)) return true;
    return false;
  };
}

/** 预估将复制的大小/文件数（与拷贝使用同一套排除规则） */
async function scanSize(dir, skip) {
  let bytes = 0;
  let files = 0;
  async function walk(p) {
    let entries;
    try { entries = await readdir(p, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(p, e.name);
      if (skip(full)) continue;
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) {
        try {
          const s = await stat(full);
          bytes += s.size;
          files++;
        } catch { /* ignore */ }
      }
    }
  }
  await walk(dir);
  return { bytes, files };
}

/**
 * 把源 profile 复制到工作区 user-data-dir 下（作为 Default）。
 * 返回 { bytesCopied, filesCopied, excludedBytes }
 */
export async function copyProfile(profileDir, destDir, opts = {}) {
  const skip = makeSkip(opts);
  const { bytes, files } = await scanSize(profileDir, skip);
  await cp(profileDir, destDir, {
    recursive: true,
    force: true,
    filter: (src) => !skip(src),
  });
  return { bytesCopied: bytes, filesCopied: files, profileDir, destDir };
}
