import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { dockerPublicationKind, dockerPrebuildDecision, movingTagPromotionArgs, splitDockerPublishTags } from '../docker-publish-policy.mjs';

const image = 'example/bivaro-kleinunternehmen';
const sha = 'a'.repeat(40);
const digest = `sha256:${'b'.repeat(64)}`;
const tags = `${image}:latest\n${image}:main\n${image}:sha-aaaaaaa`;
const eventName = 'push';
const ref = 'refs/heads/main';
const input = { image, metadataTags: tags, sha, eventName, ref, currentMainSha: sha, digest };
const workflow = readFileSync('.github/workflows/docker-publish.yml', 'utf8');
const scripts = [...workflow.matchAll(/script: \|\n([\s\S]*?)(?=\n      - name:|$)/g)]
  .map(match => match[1].replace(/^            /gm, '').replace(/await import\(`[^`]+`\)/g, 'helpers'));

function runWorkflowScript(index: number, currentSha = sha, lookupFailure = false, metadataTags = tags, eventRef = ref) {
  const setOutput = vi.fn();
  const execFileSync = vi.fn();
  const getRef = lookupFailure ? vi.fn().mockRejectedValue(new Error('lookup unavailable')) : vi.fn().mockResolvedValue({ data: { object: { sha: currentSha } } });
  const promise = new vm.Script(`(async () => { ${scripts[index]} })()`).runInNewContext({
    helpers: { dockerPublicationKind, dockerPrebuildDecision, splitDockerPublishTags, movingTagPromotionArgs },
    process: { env: { IMAGE_NAME: image, METADATA_TAGS: metadataTags, GITHUB_SHA: sha, GITHUB_EVENT_NAME: eventName, GITHUB_REF: eventRef, IMAGE_DIGEST: digest } },
    core: { setOutput, info: vi.fn(), notice: vi.fn() }, github: { rest: { git: { getRef } } }, context: { repo: { owner: 'owner', repo: 'repo' } },
    require: (name: string) => { expect(name).toBe('node:child_process'); return { execFileSync }; },
  });
  return { promise, setOutput, execFileSync, getRef };
}

describe('Docker moving-tag provenance', () => {
  it('keeps SHA tags in the build and promotes both moving tags from the exact index', () => {
    expect(splitDockerPublishTags({ image, metadataTags: tags, sha, eventName, ref })).toEqual({ buildTags: [`${image}:sha-aaaaaaa`], movingTags: [`${image}:latest`, `${image}:main`] });
    expect(movingTagPromotionArgs(input)).toEqual(['buildx', 'imagetools', 'create', '--tag', `${image}:latest`, '--tag', `${image}:main`, `${image}@${digest}`]);
  });
  it('preserves every deliberate release tag, including metadata-action implicit latest', () => {
    const metadataTags = `${image}:1.2.3\n${image}:1.2\n${image}:sha-aaaaaaa\n${image}:latest`;
    const release = { ...input, metadataTags, ref: 'refs/tags/v1.2.3' };
    expect(splitDockerPublishTags(release)).toEqual({ buildTags: metadataTags.split('\n'), movingTags: [] });
    expect(movingTagPromotionArgs({ ...release, currentMainSha: '' })).toEqual([]);
  });
  it('does not advance moving aliases from stale builds or invent aliases absent from metadata', () => {
    expect(movingTagPromotionArgs({ ...input, currentMainSha: 'c'.repeat(40) })).toEqual([]);
    expect(movingTagPromotionArgs({ ...input, metadataTags: `${image}:sha-aaaaaaa` })).toEqual([]);
  });
  it.each(['', 'not-a-sha', 'A'.repeat(40)])('rejects unavailable/malformed current-ref evidence %s', currentMainSha => {
    expect(() => movingTagPromotionArgs({ ...input, currentMainSha })).toThrow('Invalid Docker promotion provenance');
  });
  it.each(['', 'sha256:wrong', `sha256:${'b'.repeat(64)}\n--tag evil`])('rejects malformed digest %s', badDigest => {
    expect(() => movingTagPromotionArgs({ ...input, digest: badDigest })).toThrow('Invalid Docker promotion provenance');
  });
  it.each([`${image}:main`, `${tags}\nother/repo:latest`, `${tags}\n${image}:--bad`, `${tags}\n${image}:latest`, `${tags}\n${image}:x\r`, 'x'.repeat(4097)])('rejects missing SHA, foreign, malformed, duplicate or unbounded metadata', metadataTags => {
    expect(() => splitDockerPublishTags({ image, metadataTags, sha, eventName, ref })).toThrow();
  });
  it('keeps multiarch/security/cache/metadata and serializes every moving-tag publisher without cancellation', () => {
    expect(workflow).toContain('group: docker-publish-bivaro-kleinunternehmen\n  cancel-in-progress: false\n  queue: max');
    expect(workflow).toContain('platforms: linux/amd64,linux/arm64');
    expect(workflow).toContain('contents: read\n      packages: write');
    expect(workflow).toContain('labels: ${{ steps.meta.outputs.labels }}');
    expect(workflow).toContain('cache-from: type=gha\n          cache-to: type=gha,mode=max');
    expect(workflow).toContain('tags: ${{ steps.tags.outputs.build-tags }}');
    expect(workflow.indexOf('id: build')).toBeLessThan(workflow.lastIndexOf("ref: 'heads/main'"));
    expect(workflow).not.toContain('continue-on-error');
  });
  it('executes the authored tag-output script with real newline-separated build tags', async () => {
    expect(scripts).toHaveLength(3);
    const result = runWorkflowScript(1, sha, false, `${tags}\n${image}:1.2.3`); await result.promise;
    expect(result.setOutput).toHaveBeenCalledExactlyOnceWith('build-tags', `${image}:sha-aaaaaaa\n${image}:1.2.3`);
    expect(result.getRef).not.toHaveBeenCalled(); expect(result.execFileSync).not.toHaveBeenCalled();
  });
  it('executes only a manifest copy after a fresh exact-main lookup', async () => {
    const result = runWorkflowScript(2); await result.promise;
    expect(result.getRef).toHaveBeenCalledExactlyOnceWith({ owner: 'owner', repo: 'repo', ref: 'heads/main' });
    expect(result.execFileSync).toHaveBeenCalledExactlyOnceWith('docker', movingTagPromotionArgs(input), { stdio: 'inherit', timeout: 120000 });
  });
  it('never invokes Docker for a stale ref', async () => {
    const result = runWorkflowScript(2, 'c'.repeat(40)); await result.promise;
    expect(result.execFileSync).not.toHaveBeenCalled();
  });
  it('leaves release latest publication in the original build and never consults main', async () => {
    const metadataTags = `${image}:1.2.3\n${image}:sha-aaaaaaa\n${image}:latest`;
    const build = runWorkflowScript(1, sha, false, metadataTags, 'refs/tags/v1.2.3'); await build.promise;
    expect(build.setOutput).toHaveBeenCalledExactlyOnceWith('build-tags', metadataTags);
    const promotion = runWorkflowScript(2, sha, false, metadataTags, 'refs/tags/v1.2.3'); await promotion.promise;
    expect(promotion.getRef).not.toHaveBeenCalled(); expect(promotion.execFileSync).not.toHaveBeenCalled();
  });
  it.each([
    { eventName: 'pull_request', ref: 'refs/heads/main' },
    { eventName: 'push', ref: 'refs/heads/other' },
    { eventName: 'push', ref: 'refs/tags/other' },
    { eventName: 'push', ref: 'refs/tags/v1.2.3\nother' },
  ])('rejects events/refs outside the unchanged trigger contract', event => {
    expect(() => splitDockerPublishTags({ ...input, ...event })).toThrow('Unsupported Docker publication event or ref');
  });
  it('preserves lookup failure and never falls back to promoting moving tags', async () => {
    const result = runWorkflowScript(2, sha, true);
    await expect(result.promise).rejects.toThrow('lookup unavailable');
    expect(result.execFileSync).not.toHaveBeenCalled();
  });
  it('preserves a registry command failure rather than claiming publication succeeded', async () => {
    const result = runWorkflowScript(2);
    result.execFileSync.mockImplementation(() => { throw new Error('registry unavailable'); });
    await expect(result.promise).rejects.toThrow('registry unavailable');
  });

  it('keeps current main but intentionally skips already obsolete main before any Docker work', async () => {
    expect(dockerPrebuildDecision(input)).toBe('build');
    expect(dockerPrebuildDecision({ ...input, currentMainSha: 'c'.repeat(40) })).toBe('skip-obsolete-main');
    const current = runWorkflowScript(0); await current.promise;
    expect(current.setOutput).toHaveBeenCalledWith('publish', true);
    const stale = runWorkflowScript(0, 'c'.repeat(40)); await stale.promise;
    expect(stale.setOutput).toHaveBeenCalledWith('publish', false);
    expect(stale.setOutput).toHaveBeenCalledWith('decision', 'skip-obsolete-main');
    expect(stale.execFileSync).not.toHaveBeenCalled();
  });
  it('always retains deliberate release builds without a main lookup', async () => {
    expect(dockerPrebuildDecision({ ...input, ref: 'refs/tags/v1.2.3', currentMainSha: undefined })).toBe('build');
    const release = runWorkflowScript(0, sha, true, tags, 'refs/tags/v1.2.3'); await release.promise;
    expect(release.setOutput).toHaveBeenCalledWith('publish', true);
    expect(release.getRef).not.toHaveBeenCalled();
  });
  it.each(['', 'not-a-sha', 'A'.repeat(40)])('does not turn malformed prebuild evidence into a successful skip', currentMainSha => {
    expect(() => dockerPrebuildDecision({ ...input, currentMainSha })).toThrow('Invalid Docker prebuild provenance');
  });
  it('propagates prebuild lookup errors without a build/skip decision', async () => {
    const result = runWorkflowScript(0, sha, true);
    await expect(result.promise).rejects.toThrow('lookup unavailable');
    expect(result.setOutput).not.toHaveBeenCalled(); expect(result.execFileSync).not.toHaveBeenCalled();
  });
  it('guards every Docker step, before setup/login, and retains the independent postbuild check', () => {
    const steps = workflow.split(/\n      - name: /).slice(1);
    expect(steps[0]).toContain('Checkout code'); expect(steps[1]).toContain('id: prebuild');
    expect(steps.slice(2)).toHaveLength(6);
    for (const step of steps.slice(2)) expect(step).toContain("if: steps.prebuild.outputs.publish == 'true'");
    expect(workflow.match(/ref: 'heads\/main'/g)).toHaveLength(2);
    expect(steps[1]).not.toContain('DOCKERHUB_TOKEN'); expect(steps[1]).not.toContain('execFileSync');
  });
});
