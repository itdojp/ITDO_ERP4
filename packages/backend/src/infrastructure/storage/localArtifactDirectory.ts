import { constants, type Stats } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import path from 'node:path';

const SAFE_CHILD_NAME_PATTERN = /^[a-zA-Z0-9._-]{1,180}$/;

function currentUid(errorCode: string) {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error(errorCode);
  return uid;
}

function assertOwnedDirectory(info: Stats) {
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== currentUid('artifact_local_directory_unsafe') ||
    (info.mode & 0o077) !== 0
  ) {
    throw new Error('artifact_local_directory_unsafe');
  }
}

function childPath(handle: FileHandle, name: string) {
  if (name === '.' || name === '..' || !SAFE_CHILD_NAME_PATTERN.test(name)) {
    throw new Error('artifact_provider_key_invalid');
  }
  return path.join('/proc/self/fd', String(handle.fd), name);
}

export async function assertSafeLocalFileHandle(handle: FileHandle) {
  const info = await handle.stat();
  if (
    !info.isFile() ||
    info.uid !== currentUid('artifact_local_file_unsafe') ||
    (info.mode & 0o077) !== 0
  ) {
    throw new Error('artifact_local_file_unsafe');
  }
  return info;
}

export type LocalArtifactDirectory = {
  assertBound: () => Promise<void>;
  close: () => Promise<void>;
  openRead: (name: string) => Promise<FileHandle>;
  openWriteExclusive: (name: string) => Promise<FileHandle>;
  unlink: (name: string) => Promise<void>;
};

export async function openLocalArtifactDirectory(
  localDir: string,
  options: { create: boolean },
): Promise<LocalArtifactDirectory | null> {
  const resolved = path.resolve(localDir);
  if (options.create) {
    try {
      await mkdir(resolved, { recursive: true, mode: 0o700 });
    } catch {
      throw new Error('artifact_local_directory_unsafe');
    }
  }

  let handle: FileHandle;
  try {
    handle = await open(
      resolved,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : '';
    if (!options.create && code === 'ENOENT') return null;
    throw new Error('artifact_local_directory_unsafe');
  }

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await handle.close();
  };
  const assertOpen = () => {
    if (closed) throw new Error('artifact_local_directory_unsafe');
  };
  const assertBound = async () => {
    assertOpen();
    try {
      const openedInfoBefore = await handle.stat();
      assertOwnedDirectory(openedInfoBefore);
      const pathInfoBefore = await lstat(resolved);
      assertOwnedDirectory(pathInfoBefore);
      const canonicalPath = await realpath(resolved);
      const pathInfoAfter = await lstat(resolved);
      assertOwnedDirectory(pathInfoAfter);
      const openedInfoAfter = await handle.stat();
      assertOwnedDirectory(openedInfoAfter);
      if (
        canonicalPath !== resolved ||
        openedInfoBefore.dev !== openedInfoAfter.dev ||
        openedInfoBefore.ino !== openedInfoAfter.ino ||
        openedInfoAfter.dev !== pathInfoBefore.dev ||
        openedInfoAfter.ino !== pathInfoBefore.ino ||
        openedInfoAfter.dev !== pathInfoAfter.dev ||
        openedInfoAfter.ino !== pathInfoAfter.ino
      ) {
        throw new Error('artifact_local_directory_unsafe');
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'artifact_local_directory_unsafe'
      ) {
        throw error;
      }
      throw new Error('artifact_local_directory_unsafe');
    }
  };

  try {
    await assertBound();
    await realpath('/proc/self/fd');
  } catch (error) {
    await close().catch(() => undefined);
    if (
      error instanceof Error &&
      error.message === 'artifact_local_directory_unsafe'
    ) {
      throw error;
    }
    throw new Error('artifact_local_directory_unsafe');
  }

  return {
    assertBound,
    close,
    openRead: async (name) => {
      assertOpen();
      return open(
        childPath(handle, name),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
    },
    openWriteExclusive: async (name) => {
      assertOpen();
      return open(
        childPath(handle, name),
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );
    },
    unlink: async (name) => {
      assertOpen();
      await unlink(childPath(handle, name));
    },
  };
}
