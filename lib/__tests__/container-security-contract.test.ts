import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const read=(p:string)=>readFileSync(path.join(root,p),'utf8');
describe('patched container compatibility gate',()=>{
  it('uses patched Debian security packages with a build-time minimum',()=>{
    const docker=read('Dockerfile');
    expect(docker.match(/FROM node:22\.23\.4-trixie-slim/g)).toHaveLength(2);
    expect(docker).toContain("ge '10.05.1~dfsg-1+deb13u3'");
    expect(docker).not.toContain('bookworm');
  });
  it('exercises both native architectures without publishing or host data access',()=>{
    const workflow=read('.github/workflows/container-runtime.yml');
    expect(workflow).toContain('runner: [ubuntu-24.04, ubuntu-24.04-arm]');
    expect(workflow).toContain('docker build --pull');
    expect(workflow).toContain('--network=none');
    expect(workflow).not.toContain('docker push');
    const mounts = [...workflow.matchAll(/--mount type=bind,src="([^"]+)",dst=([^,\s]+),readonly/gu)]
      .map(([, source, destination]) => ({ source, destination }));
    expect(mounts).toEqual([
      { source: '$PWD/scripts/container-runtime-smoke.sh', destination: '/tmp/container-runtime-smoke.sh' },
      { source: '$PWD/scripts/own-invoice-pdfa/container-smoke.mjs', destination: '/tmp/own-invoice-container-smoke.mjs' },
      { source: '$PWD/lib/__tests__/fixtures/incoming-validation', destination: '/tmp/validator-fixtures' },
      { source: '$PWD/node_modules/sax', destination: '/tmp/smoke-sax' },
      { source: '$PWD/node_modules', destination: '/tmp/own-invoice-test/node_modules' },
    ]);
    expect(workflow.match(/--mount\b/gu)).toHaveLength(mounts.length);
    expect(workflow).not.toMatch(/--(?:privileged|cap-add|security-opt|volume)(?:[=\s]|$)|--(?:network|pid|ipc|userns)=host/gu);
    expect(workflow).toContain('docker cp bivaro-runtime-smoke:/tmp/bivaro-own-invoice-container-smoke/.');
    expect(workflow).toContain('npm ci --ignore-scripts');
  });
  it('checks actual entrypoint, database, renderer and real offline validation with bounded polling',()=>{
    const script=read('scripts/container-runtime-smoke.sh');
    expect(script).toContain('DATABASE_MIGRATION_MODE=manual sh /app/docker-entrypoint.sh');
    expect(script).toContain('DATABASE_URL=file:/tmp/bivaro-container-smoke.db');
    expect(script).toContain('for format in cii ubl');
    expect(script).toContain("['val-xml','val-xsd','val-sch.1','val-sch.2']");
    expect(script).toContain('--connect-timeout 1 --max-time 2');
    expect(script).toContain('-sDEVICE=png16m');
    expect(script).toContain('[ "$(id -u)" != 0 ]');
  });
});
