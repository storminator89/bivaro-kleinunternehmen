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
    expect(workflow.match(/readonly/g)).toHaveLength(2);
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
