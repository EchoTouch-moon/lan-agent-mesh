import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';

/** Only call with a process spawned and owned by this client, never a PID from persisted state. */
export async function terminateOwnedChild(child: ChildProcessWithoutNullStreams, exited: Promise<void>, exitObserved: () => boolean, allowVersionExit = false): Promise<void> {
  if (child.pid) {
    if (process.platform === 'win32' && exitObserved() && !allowVersionExit) throw new Error('Owned process cleanup uncertain');
    if (process.platform === 'win32' && !exitObserved()) {
      const killer = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
        ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { killer.kill(); reject(new Error('Owned process cleanup uncertain')); }, 5000);
        killer.once('error', () => { clearTimeout(timer); reject(new Error('Owned process cleanup uncertain')); });
        killer.once('close', code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error('Owned process cleanup uncertain')); });
      });
    } else if (process.platform !== 'win32') {
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw new Error('Owned process cleanup uncertain'); }
    }
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Owned process cleanup uncertain')), 5000);
    void exited.then(() => { clearTimeout(timer); resolve(); });
  });
}
