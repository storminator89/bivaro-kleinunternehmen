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
    expect(smoke).toContain('probeTrustedVerifierStartup({foreignVerifierCommand,veraPdfSpawnSpecification,prepareForeignVerifierConfig,assertForeignVerifierConfigOnly})');
    expect(smoke.indexOf('probeTrustedVerifierStartup({foreignVerifierCommand,veraPdfSpawnSpecification,prepareForeignVerifierConfig,assertForeignVerifierConfigOnly})')).toBeLessThan(smoke.indexOf('stage=`source-precheck-${name}`'));
    const probe=read('scripts/foreign-pdf/startup-probe.mjs');
    expect(probe.match(/await assertForeignVerifierConfigOnly\(directory,configuration\)/g)).toHaveLength(2);
    expect(probe).toContain('configuration=await prepareForeignVerifierConfig(BINARY,directory)');
    expect(probe).toContain("const MAX_OUTPUT=2*1024*1024,MAX_EXCERPT=4096,TIMEOUT=30_000");
    expect(read('app/api/pdfa3/route.ts')).not.toContain('startup-probe');
    expect(read('scripts/foreign-pdf/worker.mjs')).not.toContain('startup-probe');
    expect(smoke).toContain('assert.equal(startup.configuration?.templates.length,5)');
    expect(smoke.indexOf('assert.equal(startup.configuration?.templates.length,5)')).toBeGreaterThan(smoke.indexOf('await validatePdfA3(response.bytes'));
    const validator=read('lib/server/pdfa-validator.ts');
    expect(validator).toContain('if (options.confined)\n      await prepareForeignVerifierConfig(binary, workDir)');
    expect(validator.indexOf('await prepareForeignVerifierConfig')).toBeLessThan(validator.indexOf("const version = await runVeraPdf"));
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
  it('binds the additional harness diagnostic to exact synthetic bytes and leaves all production gates mandatory',()=>{
    const workflow=read('.github/workflows/foreign-pdf-compatibility.yml'),smoke=read('scripts/foreign-pdf/native-smoke.mjs'),fixture=read('scripts/foreign-pdf/build-native-fixtures.mjs'),probe=read('scripts/foreign-pdf/fixture-validation-probe.mjs');
    expect(workflow).toContain('"$RUNNER_TEMP/foreign-pdf-fixtures" "$GITHUB_SHA"');
    expect(workflow).toContain('--env BIVARO_FOREIGN_SOURCE_CHECKOUT="$GITHUB_SHA"');
    expect(fixture).toContain('vector:base');expect(fixture).toContain('sourceCheckout:process.argv[3]');
    expect(probe).toContain('assertFixtureProvenance(manifest,expected)');
    expect(probe.match(/await boundary\(directory,configuration,expected.fixture\)/g)).toHaveLength(2);
    expect(probe).toContain("const args=['--flavour','3b','--format','json','--maxfailuresdisplayed','10','--loglevel','0',pdfPath]");
    expect(smoke.indexOf('probeTrustedFixtureValidation({')).toBeLessThan(smoke.indexOf('stage=`source-precheck-${name}`'));
    expect(smoke.indexOf("assert.equal(fixtureDiagnostic.outcome,'passed')")).toBeGreaterThan(smoke.indexOf('assert.deepEqual(await snapshot(),before)'));
    for(const file of ['app/api/pdfa3/route.ts','lib/server/pdfa-validator.ts','lib/server/pdfa3-converter.ts','scripts/foreign-pdf/worker.mjs'])expect(read(file)).not.toContain('fixture-validation-probe');
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
  it('pins the single foreign application entry and build-only compiler without changing official validation or runtime confinement',()=>{
    const java=read('scripts/foreign-pdf/ForeignVerifierMain.java'),identity=read('scripts/foreign-pdf/adapter-identity.mjs'),prepare=read('scripts/foreign-pdf/prepare-verifier-adapter.mjs'),docker=read('Dockerfile');
    expect(java).toContain('SeekableInputStream.setMaxStreamSize(2097152)');expect(java).toContain('SeekableInputStream.setMaxBufferSize(2097153)');expect(java).toContain('GreenfieldCliWrapper.main(args)');
    expect(java).not.toMatch(/catch\s*\(|System\.|VeraPdfCli\.main|args\[|java\.io|java\.nio|reflect/);
    expect(identity).toContain("['--release','21','-proc:none','-g:none','-encoding','UTF-8']");
    expect(prepare).toContain("sha(source)!==ADAPTER_SOURCE_SHA256");expect(prepare).toContain("sha(await bytes(jar,64*1024*1024))!==OFFICIAL_CLI_SHA256");
    expect(docker.split('FROM node:22.23.4-trixie-slim AS runner')[0]).toContain('default-jdk-headless');
    expect(docker.split('FROM node:22.23.4-trixie-slim AS runner')[1]).not.toContain('default-jdk-headless');
    expect(read('scripts/foreign-pdf/container-gate.sh')).toContain('! command -v javac');
    expect(read('lib/server/foreign-pdf-verifier-adapter.ts')).toContain("['ForeignVerifierMain.class']");
    expect(read('lib/server/own-invoice-pdfa-validator.ts')).not.toContain('ForeignVerifierMain');
  });
  it('requires actual font-length/compile identity plus passing and rejected stream-boundary evidence in addition to all existing coverage',()=>{
    const fixture=read('scripts/foreign-pdf/build-native-fixtures.mjs'),smoke=read('scripts/foreign-pdf/native-smoke.mjs'),workflow=read('.github/workflows/foreign-pdf-compatibility.yml');
    expect(fixture).toContain('describeGeneratedVectorFont(doc)');expect(fixture).toContain("['stream-at-limit',NEW_STREAM_MAX_BYTES],['stream-over-limit',NEW_STREAM_MAX_BYTES+2048]");
    expect(fixture).toContain('descriptorSourceSha256:');expect(fixture).toContain('boundarySourceSha256:');expect(fixture).toContain('lockSha256:provenance.lockSha256');expect(fixture).toContain('pdfkit:provenance.pdfkit');
    expect(smoke).toContain("await verifyForeignVerifierAdapter('/opt/verapdf')");for(const name of ['verifier-adapter-source.java','verifier-adapter-class.bin','verifier-adapter-build.json','bounded-streams.json'])expect(smoke).toContain(name);
    expect(smoke).toContain("stage='bounded-stream-at-limit';await validatePdfA3(await original('stream-at-limit'),{confined:true})");
    expect(smoke).toContain("assert.fail('An over-limit materialized stream passed')");expect(smoke).toContain('assert(error instanceof PdfA3ValidationError)');
    expect(smoke.indexOf("stage='bounded-stream-at-limit'")).toBeGreaterThan(smoke.indexOf('for(const [name,expected]of Object.entries(allCases.negative))'));
    expect(workflow).toContain('m.boundedStreams?.atLimit.status!=="passed"');expect(workflow).toContain('m.boundedStreams?.overLimit.status!=="rejected"');
  });
});
