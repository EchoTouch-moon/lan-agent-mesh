import { win32 } from 'node:path';

/** @param {string} launcher @param {string[]} args */
export function windowsCmdLauncher(launcher, args) {
  if (!win32.isAbsolute(launcher) || !/\.cmd$/i.test(launcher) || /["%\r\n]/.test(launcher)) throw new Error('Expected an absolute .cmd launcher path without quotes, percent expansion or newlines.');
  if (args.some(arg => !/^[a-z0-9_-]+$/i.test(arg))) throw new Error('Only fixed CLI flag/name arguments are allowed.');
  return { command: 'cmd.exe', args: ['/d', '/s', '/v:off', '/c', `""${launcher}" ${args.join(' ')}"`], windowsVerbatimArguments: true };
}
