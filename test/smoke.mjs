// 冒烟测试：需要一个已启动的本地服务
// 用法: npm run smoke   （需先 chrome-ws server start）
import { loadConfig, portOf } from '../src/core/config.js';

const port = portOf(loadConfig());
const base = `http://127.0.0.1:${port}`;
const NAME = `smoke-${Date.now() % 100000}`;
let failed = 0;

function ok(cond, msg) {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failed++;
}
async function api(method, p, body) {
  const res = await fetch(base + p, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

try {
  let r = await api('GET', '/api/health');
  ok(r.status === 200 && r.data.ok, 'health 检查');

  r = await api('POST', '/api/workspaces', { name: NAME, homepage: 'about:blank' });
  ok(r.status === 201 && r.data.name === NAME, `创建工作区 ${NAME}`);

  r = await api('POST', '/api/workspaces', { name: NAME });
  ok(r.status !== 201, '重复名称被拒绝');

  r = await api('POST', '/api/workspaces', { name: 'bad/name' });
  ok(r.status !== 201, '非法名称被拒绝');

  r = await api('GET', '/api/workspaces');
  ok(r.data.workspaces.some((w) => w.name === NAME), '列表中可见');

  r = await api('POST', `/api/workspaces/${NAME}/open`);
  ok(r.status === 200, 'open 启动');
  await new Promise((res) => setTimeout(res, 3000));

  r = await api('GET', '/api/workspaces');
  const ws = r.data.workspaces.find((w) => w.name === NAME);
  ok(ws?.running, '3 秒后检测为运行中');
  ok(!!ws?.pid, `有 PID (${ws?.pid})`);

  r = await api('POST', `/api/workspaces/${NAME}/close`);
  await new Promise((res) => setTimeout(res, 1500));

  r = await api('GET', '/api/workspaces');
  ok(!r.data.workspaces.find((w) => w.name === NAME)?.running, 'close 后为停止');

  r = await api('DELETE', `/api/workspaces/${NAME}?purge=1`);
  ok(r.status === 200 && r.data.purged, '删除（含数据目录）');

  // --- 导入继承现有配置 ---
  const { mkdtempSync, writeFileSync, mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const src = mkdtempSync(join(tmpdir(), 'cws-src-'));
  mkdirSync(join(src, 'Default', 'Extensions', 'ext1', '1.0'), { recursive: true });
  mkdirSync(join(src, 'Default', 'Cache'), { recursive: true });
  writeFileSync(join(src, 'Local State'), '{}');
  writeFileSync(join(src, 'Default', 'Preferences'), '{}');
  writeFileSync(join(src, 'Default', 'Bookmarks'), '{}');
  writeFileSync(join(src, 'Default', 'Cookies'), 'cookie');
  writeFileSync(join(src, 'Default', 'Extensions', 'ext1', '1.0', 'main.js'), 'x');
  writeFileSync(join(src, 'Default', 'Cache', 'junk'), 'y');

  const IMP = `${NAME}-imp`;
  r = await api('POST', '/api/workspaces/import', { name: IMP, source: src });
  ok(r.status === 201, `导入工作区 ${IMP}`);
  if (r.status === 201) {
    ok(r.data.import.filesCopied === 4, `复制 4 个文件（排除缓存）: ${r.data.import.filesCopied}`);
    const { existsSync } = await import('node:fs');
    const baseDir = r.data.workspace.dir;
    ok(existsSync(join(baseDir, 'Default', 'Bookmarks')), '书签已复制');
    ok(existsSync(join(baseDir, 'Default', 'Extensions', 'ext1', '1.0', 'main.js')), '扩展已复制');
    ok(!existsSync(join(baseDir, 'Default', 'Cache')), 'Cache 已排除');
    ok(existsSync(join(baseDir, 'Default', 'Cookies')), 'Cookies 已复制');
  }
  r = await api('DELETE', `/api/workspaces/${IMP}?purge=1`);
  ok(r.status === 200, '清理导入工作区');

  console.log(failed ? `\n${failed} 项失败` : '\n全部通过 ✅');
  process.exit(failed ? 1 : 0);
} catch (e) {
  console.error('测试异常:', e);
  process.exit(1);
}
