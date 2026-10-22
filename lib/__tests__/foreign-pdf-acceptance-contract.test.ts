import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import path from 'node:path';
const read=(name:string)=>readFileSync(path.join(import.meta.dirname,'../..',name),'utf8');
describe('mandatory foreign PDF release evidence contract (static only)',()=>{
  it('requires genuine native production images on both supported architectures, without publication or confinement relaxation',()=>{
    const workflow=read('.github/workflows/foreign-pdf-compatibility.yml');
    expect(workflow).toContain('runner: ubuntu-24.04');expect(workflow).toContain('runner: ubuntu-24.04-arm');
    expect(workflow).toContain('process.arch!==process.env.EXPECTED_ARCHITECTURE');expect(workflow).toContain('docker build --pull');expect(workflow).toContain('--network=none');
    expect(workflow).not.toMatch(/docker push|--privileged|--cap-add|--security-opt|--network=host|qemu|continue-on-error|patch .*Dockerfile/);
  });
  it('precreates the nested mount target without making either fixture bind writable',()=>{
    const fixture=read('scripts/foreign-pdf/build-native-fixtures.mjs'),workflow=read('.github/workflows/foreign-pdf-compatibility.yml');
    expect(fixture).toContain("await mkdir(path.join(destination,'node_modules'),{mode:0o755});");
    expect(fixture.indexOf("mkdir(path.join(destination,'node_modules')")).toBeGreaterThan(fixture.indexOf('mkdir(destination,{recursive:false'));
    expect(workflow).toContain('dst=/tmp/foreign-pdf-test,readonly');
    expect(workflow).toContain('dst=/tmp/foreign-pdf-test/node_modules,readonly');
    expect(workflow).not.toMatch(/dst=\/tmp\/foreign-pdf-test(?:\/node_modules)?,(?:rw|readwrite)|--privileged|--security-opt/);
  });
  it('binds actual source/final bytes, independent pixel/text comparison and readable evidence to a passing complete native matrix',()=>{
    const workflow=read('.github/workflows/foreign-pdf-compatibility.yml'),smoke=read('scripts/foreign-pdf/native-smoke.mjs');
    expect(workflow).toContain('m.cases.length!==3');expect(workflow).toContain('m.rejected.length!==7');expect(workflow).toContain('pdftoppm -scale-to 2000');expect(workflow).toContain('diff --recursive');expect(workflow).toContain('pdftotext -layout');
    expect(smoke).toContain('await validatePdfA3(response.bytes,{maxBytes:40*1024*1024,confined:true})');
    expect(smoke).toContain('assert.deepEqual(await invariant(response.bytes),await invariant(bytes))');expect(smoke).toContain('assert.equal(sha(await exactXml(response.bytes)),sha(xmlBytes))');
    expect(smoke).toContain("form.set('analysisMode','manual')");expect(smoke).toContain('assert.deepEqual(await snapshot(),before)');
    expect(smoke).not.toContain('it.skip');expect(smoke).not.toContain('vi.mock');
  });
  it('adds a confined source diagnostic without replacing production derivation or leaking raw failures',()=>{
    const smoke=read('scripts/foreign-pdf/native-smoke.mjs');
    expect(smoke).toContain('stage=`source-precheck-${name}`;await validatePdfA3(bytes,{confined:true})');
    expect(smoke).toContain('const direct=await createPdfA3Invoice(');
    expect(smoke.indexOf('stage=`source-precheck-${name}`')).toBeLessThan(smoke.indexOf('const direct=await createPdfA3Invoice('));
    expect(smoke).toContain("foreignFailureDiagnostic(error,stage)");expect(smoke).toContain('JSON.stringify(diagnostic)');
    expect(smoke).not.toContain('error.message');expect(smoke).not.toContain('error.stack');expect(smoke).toContain('process.exitCode=1');
  });
  it('never parses foreign PDFs in the parent or adds a normalizer/raster fallback',()=>{
    const source=read('lib/server/pdfa3-converter.ts');
    expect(source).not.toMatch(/from ['"]pdf-lib|PDFDocument\.load|execFile.*gs|sDEVICE/i);
    expect(source).toContain('await validatePdfA3(original, { confined: true })');
    expect(source).toContain('await validatePdfA3(candidate, { maxBytes: MAX_OUTPUT_BYTES, confined: true })');
  });
  it('packages the reviewed runtime closure in the actual Dockerfile without prematurely removing Ghostscript',()=>{
    const patch=read('scripts/foreign-pdf/Dockerfile.integration.patch'),docker=read('Dockerfile'),doc=read('docs/testing/foreign-pdf-preservation-2026-10-22.md');
    for(const name of ['pdf-lib','@pdf-lib','pako','tslib','sax'])expect(docker).toContain(`COPY --from=builder /app/node_modules/${name}`);
    expect(docker).toContain('COPY --from=builder /app/scripts/foreign-pdf');
    expect(docker).toContain('RUN sh scripts/foreign-pdf/build-sandbox-filter.sh');
    expect(docker).toContain("dpkg-query -W -f='${Version}' ghostscript");
    expect(patch).toContain('build-sandbox-filter.sh');expect(patch).not.toContain('-    apt-get');
    expect(doc).toContain('applied to the actual production Dockerfile');expect(doc).toContain('Ghostscript removal is still separate');
  });
  it('retains exactly one combined Next configuration and the AI/notices build lifecycle',()=>{
    const config=read('next.config.ts'),pkg=JSON.parse(read('package.json'));
    expect(config.match(/^  serverExternalPackages:/gm)).toHaveLength(1);expect(config.match(/^  outputFileTracingIncludes:/gm)).toHaveLength(1);
    expect(config).toContain("'pdfkit', 'fontkit', 'pdfjs-dist', '@napi-rs/canvas'");
    expect(config).toContain("'/api/pdfa3'");expect(config).toContain("'/api/invoices/render'");
    expect(pkg.scripts.prebuild).toBe('node scripts/ai-pdf/prepare-worker.mjs');expect(pkg.scripts.postbuild).toBe('node scripts/third-party-notices/build-notices.mjs');
    expect(pkg.dependencies['pdfjs-dist']).toBe('6.4.299');expect(pkg.dependencies.pdfkit).toBe('0.20.2');
  });
});
