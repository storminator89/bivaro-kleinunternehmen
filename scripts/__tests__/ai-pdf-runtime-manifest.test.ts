import { mkdtemp, rm, writeFile, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runtimeManifest } from '../ai-pdf/runtime-manifest.mjs';

describe('production closure manifest (own temporary files only)', () => {
  it('is stable on unchanged files and detects content or additional files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bivaro-runtime-manifest-'));
    try {
      await writeFile(path.join(root, 'module'), 'exact production module');
      const before = await runtimeManifest(root);
      expect(await runtimeManifest(root)).toEqual(before);
      await writeFile(path.join(root, 'module'), 'changed production module');
      expect(await runtimeManifest(root)).not.toEqual(before);
      await writeFile(path.join(root, 'module'), 'exact production module');
      expect(await runtimeManifest(root)).toEqual(before);
      await writeFile(path.join(root, 'extra-module'), 'must not mask packaging');
      expect(await runtimeManifest(root)).not.toEqual(before);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('detects permission and symbolic-link target changes without following links', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'bivaro-runtime-manifest-'));
    try {
      const file = path.join(root, 'module'), link = path.join(root, 'alias');
      await writeFile(file, 'production', { mode: 0o600 });
      await symlink('module', link);
      const before = await runtimeManifest(root);
      await chmod(file, 0o400); expect(await runtimeManifest(root)).not.toEqual(before);
      await chmod(file, 0o600); expect(await runtimeManifest(root)).toEqual(before);
      await rm(link); await symlink('nonexistent-outside-target', link);
      expect(await runtimeManifest(root)).not.toEqual(before);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
