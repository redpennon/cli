import { closeSync, constants, openSync, realpathSync, writeSync } from 'node:fs';
import { dirname, relative } from 'node:path';

/**
 * Write `data` to `path` without following a symlink at the final component
 * (`O_NOFOLLOW`), so a link planted in a cloned repository cannot redirect
 * the write onto another file (SAST #30). Throws a clear error if it would.
 * When `root` is given, the parent directory must also resolve inside it.
 */
export function writeFileNoFollow(path: string, data: string, root?: string): void {
  if (root !== undefined) {
    const realParent = realpathSync(dirname(path));
    const rel = relative(realpathSync(root), realParent);
    if (rel.startsWith('..') || rel.startsWith('/')) {
      throw new Error(`Refusing to write "${path}": its directory is outside "${root}" (symlink).`);
    }
  }
  let fd: number;
  try {
    fd = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0),
      0o666,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') {
      throw new Error(`Refusing to write "${path}": it is a symlink.`);
    }
    throw error;
  }
  try {
    writeSync(fd, data);
  } finally {
    closeSync(fd);
  }
}

