import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/browser-acceptance.yml', 'utf8');
const chromium = 'Install Chromium and system dependencies';
const pdf = 'Install and verify PDF and virtual display dependencies';
const config = 'Acquire::Retries "1";\nAcquire::http::Timeout "20";\nAcquire::https::Timeout "20";\n';

function shellStep(name: string) {
  const step = workflow.split(`      - name: ${name}\n`)[1]?.split('\n      - name: ')[0];
  if (!step) throw new Error(`Missing workflow step: ${name}`);
  expect(step).toContain('        shell: bash');
  expect(step).toContain('        run: |\n');
  return step.split('        run: |\n')[1].split('\n').map(line => line.replace(/^          /, '')).join('\n');
}

// Run only the workflow's shell plumbing with command stand-ins. No local sudo,
// apt, package installer, Playwright CLI or browser process is ever executed.
function runSetup(name: string, settings = 'valid', failCommand = '') {
  const fixture = mkdtempSync(path.join(tmpdir(), 'bivaro-apt-contract-'));
  try {
    const bin = path.join(fixture, 'bin');
    const runnerTemp = path.join(fixture, 'runner-temp');
    const workspace = path.join(fixture, 'workspace');
    mkdirSync(bin); mkdirSync(runnerTemp);
    mkdirSync(path.join(workspace, 'node_modules/playwright'), { recursive: true });
    writeFileSync(path.join(workspace, 'node_modules/playwright/cli.js'), '// never executed\n');
    const calls = path.join(fixture, 'calls');
    const configs = path.join(fixture, 'configs');
    writeFileSync(calls, ''); writeFileSync(configs, '');
    const executable = (name: string, source: string) => {
      const target = path.join(bin, name); writeFileSync(target, `#!/bin/bash\nset -eu\n${source}\n`); chmodSync(target, 0o755);
    };
    executable('sudo', `
printf 'sudo' >> "$BIVARO_APT_CALLS"; printf ' <%s>' "$@" >> "$BIVARO_APT_CALLS"; printf '\\n' >> "$BIVARO_APT_CALLS"
[[ "$1" == env && "$2" == APT_CONFIG=* ]]
cfg="\${2#APT_CONFIG=}"
[[ "$cfg" == "$RUNNER_TEMP"/bivaro-apt-*.conf && -f "$cfg" ]]
cat "$cfg" >> "$BIVARO_APT_CONFIGS"; printf '<END>\\n' >> "$BIVARO_APT_CONFIGS"
if [[ "$3" == apt-config ]]; then
  timeout=20; retries=1
  case "\${BIVARO_APT_SETTINGS#https-}" in
    stricter) timeout=15 ;;
    minimum) timeout=1 ;;
    wrong) timeout=45 ;;
    zero) timeout=0 ;;
    negative) timeout=-1 ;;
    too-large) timeout=21 ;;
    noninteger) timeout=1.5 ;;
    nonnumeric) timeout=nope ;;
    empty-value) timeout='' ;;
    retry) retries=2 ;;
    retry-zero) retries=0 ;;
    empty) exit 0 ;;
  esac
  http_timeout="$timeout"
  [[ "$BIVARO_APT_SETTINGS" != https-* ]] || http_timeout=20
  printf "%s\\n" "BIVARO_APT_RETRIES='$retries'"
  [[ "$BIVARO_APT_SETTINGS" == missing ]] || printf "%s\\n" "BIVARO_APT_HTTP_TIMEOUT='$http_timeout'"
  if [[ "$BIVARO_APT_SETTINGS" == duplicate-three ]]; then
    printf "%s\\n" "BIVARO_APT_HTTP_TIMEOUT='$timeout'"
  elif [[ "$BIVARO_APT_SETTINGS" == unexpected-three ]]; then
    printf "%s\\n" "UNEXPECTED='$timeout'"
  elif [[ "$BIVARO_APT_SETTINGS" != https-missing ]]; then
    printf "%s\\n" "BIVARO_APT_HTTPS_TIMEOUT='$timeout'"
  fi
  [[ "$BIVARO_APT_SETTINGS" != duplicate ]] || printf "%s\\n" "BIVARO_APT_HTTP_TIMEOUT='$timeout'"
  [[ "$BIVARO_APT_SETTINGS" != unexpected ]] || printf "%s\\n" "UNEXPECTED='20'"
  :
elif [[ "$3" == "$BIVARO_APT_NODE" ]]; then
  [[ "$4" == "$GITHUB_WORKSPACE/node_modules/playwright/cli.js" && "$5" == install-deps && "$6" == chromium ]]
  [[ "$BIVARO_APT_FAIL" != deps ]] || exit 71
elif [[ "$3" == apt-get ]]; then
  [[ "$BIVARO_APT_FAIL" != update || "$4" != update ]] || exit 72
else
  exit 90
fi`);
    executable('node', `printf 'node' >> "$BIVARO_APT_CALLS"; printf ' <%s>' "$@" >> "$BIVARO_APT_CALLS"; printf '\\n' >> "$BIVARO_APT_CALLS"`);
    for (const name of ['Xvfb', 'xvfb-run', 'xauth']) executable(name, 'exit 0');
    executable('sh', `[[ "$#" == 1 && "$1" == scripts/assert-no-ghostscript.sh ]]
printf 'sh <%s>\\n' "$1" >> "$BIVARO_APT_CALLS"
[[ "$BIVARO_APT_FAIL" != absence ]] || exit 73`);
    const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', shellStep(name)], {
      encoding: 'utf8', timeout: 5_000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: runnerTemp, GITHUB_WORKSPACE: workspace,
        BIVARO_APT_CALLS: calls, BIVARO_APT_CONFIGS: configs, BIVARO_APT_SETTINGS: settings,
        BIVARO_APT_FAIL: failCommand, BIVARO_APT_NODE: path.join(bin, 'node') },
    });
    expect(result.error).toBeUndefined();
    return { ...result, calls: readFileSync(calls, 'utf8'), configs: readFileSync(configs, 'utf8').split('<END>\n').filter(Boolean), remaining: readdirSync(runnerTemp) };
  } finally { rmSync(fixture, { recursive: true, force: true }); }
}

describe('per-command browser dependency transport bounds', () => {
  it('passes the verified temp-only configuration through root dependency installation and downloads the browser without sudo', () => {
    const result = runSetup(chromium);
    expect(result.status, result.stderr).toBe(0);
    expect(result.configs).toEqual([config, config]);
    expect(result.calls).toContain('<apt-config> <shell>');
    expect(result.calls).toContain('<install-deps> <chromium>');
    expect(result.calls.split('\n').find(line => line.startsWith('node'))).toContain('<install> <chromium>');
    expect(result.calls).not.toMatch(/^sudo.*<install> <chromium>/m);
    expect(shellStep(chromium)).not.toContain('npx');
    expect(result.remaining).toEqual([]);
  });

  it('uses the same verified settings for PDF apt commands and verifies the Ghostscript-free replacement environment', () => {
    const result = runSetup(pdf);
    expect(result.status, result.stderr).toBe(0);
    expect(result.configs).toEqual([config, config, config]);
    expect(result.calls).toContain('<apt-get> <update>');
    expect(result.calls).toContain('<apt-get> <install> <-y> <--no-install-recommends> <xvfb> <xauth> <default-jre-headless> <util-linux> <poppler-utils>');
    expect(result.calls).toContain('sh <scripts/assert-no-ghostscript.sh>');
    expect(result.calls).not.toContain('<ghostscript>');
    expect(result.remaining).toEqual([]);
  });

  for (const name of [chromium, pdf]) {
    for (const settings of ['stricter', 'minimum']) {
      it(`preserves stricter positive bounded ${settings} runner timeouts in ${name}`, () => {
        const result = runSetup(name, settings);
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain(`BIVARO_APT_HTTP_TIMEOUT='${settings === 'stricter' ? 15 : 1}'`);
        expect(result.stdout).toContain(`BIVARO_APT_HTTPS_TIMEOUT='${settings === 'stricter' ? 15 : 1}'`);
        expect(result.configs).toEqual(name === chromium ? [config, config] : [config, config, config]);
        expect(result.calls).toContain(name === chromium ? '<install-deps> <chromium>' : '<apt-get> <update>');
        expect(result.remaining).toEqual([]);
      });
    }
    for (const settings of ['wrong', 'missing', 'zero', 'negative', 'too-large', 'noninteger', 'nonnumeric', 'empty', 'empty-value', 'duplicate', 'duplicate-three', 'unexpected', 'unexpected-three', 'retry', 'retry-zero', 'https-missing', 'https-zero', 'https-negative', 'https-too-large', 'https-noninteger', 'https-nonnumeric', 'https-empty-value']) {
      it(`fails closed before installation for ${settings} effective values in ${name}`, () => {
        const result = runSetup(name, settings);
        expect(result.status).toBe(1);
        expect(result.stdout).toContain('::error::Unexpected per-command APT transport settings.');
        expect(result.calls).not.toContain('<apt-get>');
        expect(result.calls).not.toContain('<install-deps>');
        expect(result.calls).not.toMatch(/^node/m);
        expect(result.remaining).toEqual([]);
      });
    }
  }

  it('does not download the browser after a failed dependency installation', () => {
    const result = runSetup(chromium, 'valid', 'deps');
    expect(result.status).toBe(71);
    expect(result.calls).not.toMatch(/^node/m);
    expect(result.remaining).toEqual([]);
  });

  it('does not install PDF packages after a failed apt update', () => {
    const result = runSetup(pdf, 'valid', 'update');
    expect(result.status).toBe(72);
    expect(result.calls).not.toContain('<apt-get> <install>');
    expect(result.remaining).toEqual([]);
  });

  it('fails the PDF setup gate if the independent absence guard rejects the environment', () => {
    const result = runSetup(pdf, 'valid', 'absence');
    expect(result.status).toBe(73);
    expect(result.remaining).toEqual([]);
  });

  it('retains existing acceptance limits, evidence policy and package trust configuration', () => {
    expect(workflow).toContain('    timeout-minutes: 45');
    expect(workflow).toContain('        timeout-minutes: 25');
    expect(workflow).toContain('--retries=0');
    const allowed = workflow.split('          allowed = {')[1].split('          }')[0].match(/'[^']+\.png'/g);
    expect(allowed).toHaveLength(87); // 59 baseline + 20 customer/import + eight settings views.
    expect(new Set(allowed).size).toBe(87);
    for (const name of ['settings-redesign-light-1440.png', 'settings-redesign-light-375.png', 'settings-redesign-dark-1440.png', 'settings-redesign-dark-375.png', 'settings-redesign-backup-light-1440.png', 'settings-redesign-backup-dark-375.png', 'settings-redesign-company-saving-light-1440.png', 'settings-redesign-company-error-dark-375.png']) expect(allowed).toContain(`'${name}'`);
    for (const theme of ['light', 'dark']) for (const width of [1440, 390]) expect(allowed).toContain(`'dashboard-overview-${theme}-${width}.png'`);
    expect(allowed).toContain("'customer-redesign-directory-light-1440.png'");
    expect(allowed).toContain("'csv-redesign-customer-preview-light-1440.png'");
    expect(allowed).toContain("'csv-redesign-article-preview-light-1440.png'");
    expect(allowed).toContain("'customer-redesign-directory-light-375.png'");
    expect(allowed).toContain("'csv-redesign-customer-preview-light-375.png'");
    expect(allowed).toContain("'csv-redesign-article-preview-light-375.png'");
    expect(allowed).toContain("'customer-redesign-directory-dark-1440.png'");
    expect(allowed).toContain("'csv-redesign-customer-preview-dark-1440.png'");
    expect(allowed).toContain("'csv-redesign-article-preview-dark-1440.png'");
    expect(allowed).toContain("'customer-redesign-directory-dark-375.png'");
    expect(allowed).toContain("'csv-redesign-customer-preview-dark-375.png'");
    expect(allowed).toContain("'csv-redesign-article-preview-dark-375.png'");
    expect(allowed).toContain("'customer-redesign-edit-light-1440.png'");
    expect(allowed).toContain("'customer-redesign-edit-bottom-light-1440.png'");
    expect(allowed).toContain("'customer-redesign-edit-top-light-375.png'");
    expect(allowed).toContain("'customer-redesign-edit-bottom-light-375.png'");
    expect(allowed).toContain("'csv-redesign-article-setup-light-1440.png'");
    expect(allowed).toContain("'csv-redesign-customer-mapping-light-375.png'");
    expect(allowed).toContain("'csv-redesign-article-mapping-dark-1440.png'");
    expect(allowed).toContain("'csv-redesign-result-dark-375.png'");
    for (const name of ['bank-allocation-confirmation-1440.png', 'bank-allocation-move-390.png', 'bank-allocation-current-origin-360.png']) expect(allowed).toContain(`'${name}'`);
    expect(allowed).toContain("'receipt-sequence-desktop-1440.png'");
    expect(allowed).toContain("'receipt-sequence-mobile-390.png'");
    expect(workflow).toContain('limit = 10 * 1024 * 1024');
    expect(workflow).toContain('per_file_input_limit = 5 * 1024 * 1024');
    expect(workflow).toContain('total > 16 * 1024 * 1024');
    expect(workflow).toContain('handle.read(per_file_input_limit + 1)');
    expect(workflow).toContain('          retention-days: 1');
    expect(workflow).toContain('          compression-level: 0');
    for (const name of [chromium, pdf]) {
      const script = shellStep(name);
      expect(script).not.toMatch(/\/etc\/apt|sources\.list|apt-mirrors|AllowUnauthenticated|AllowInsecure|Verify-Peer|Verify-Host|ForceIPv/);
      expect(script).not.toMatch(/\beval\b/);
      expect(script).toContain('trap \'rm -f -- "$apt_config"\' EXIT');
    }
  });
});
