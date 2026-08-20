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

  console.log(failed ? `\n${failed} 项失败` : '\n全部通过 ✅');
  process.exit(failed ? 1 : 0);
} catch (e) {
  console.error('测试异常:', e);
  process.exit(1);
}
