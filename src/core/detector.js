// 运行状态检测
import fs from 'node:fs';
import path from 'node:path';

/** 是否运行中：SingletonLock 存在 或 记录的 lastPid 存活 */
export function isRunning(ws) {
  if (fs.existsSync(path.join(ws.dir, 'SingletonLock'))) return true;
  if (ws.lastPid) {
    try {
      process.kill(ws.lastPid, 0);
      return true;
    } catch {
      /* dead */
    }
  }
  return false;
}

/** 返回（尽力而为的）运行 PID，未运行返回 null */
export function runningPid(ws) {
  if (ws.lastPid) {
    try {
      process.kill(ws.lastPid, 0);
      return ws.lastPid;
    } catch {
      /* dead */
    }
  }
  return null;
}
