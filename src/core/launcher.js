// Chrome 实例启停
import { spawn } from 'node:child_process';

/**
 * 启动（或激活）一个工作区对应的 Chrome 实例。
 * - 未运行：拉起完整实例，返回主进程 PID（作为 lastPid 记录）
 * - 已运行：spawn 的进程只是向既有实例发“开新窗口/页”的信号，随即退出，PID 无意义
 */
export function launch(cfg, ws, url) {
  const args = [
    `--user-data-dir=${ws.dir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];
  if (ws.debugPort) args.push(`--remote-debugging-port=${ws.debugPort}`);
  const target = url || ws.homepage;
  if (target) args.push(target);

  const child = spawn(cfg.chromeBin, args, { detached: true, stdio: 'ignore' });
  child.unref();
  return child.pid;
}

/**
 * 关闭工作区实例：优先对记录的 lastPid 发 SIGTERM（优雅退出），
 * 失败则 pkill -f user-data-dir 兜底。
 */
export function close(ws) {
  if (ws.lastPid) {
    try {
      process.kill(ws.lastPid, 'SIGTERM');
      return true;
    } catch {
      /* pid 已失效，走兜底 */
    }
  }
  try {
    const killer = spawn('pkill', ['-f', `user-data-dir=${ws.dir}`], { stdio: 'ignore' });
    killer.unref();
    return true;
  } catch {
    return false;
  }
}
