// Pure publication planning: main builds defer moving aliases until a fresh ref check.
// Credentials, network access and Docker execution stay in the workflow.
function validImage(image) {
  return typeof image === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}\/bivaro-kleinunternehmen$/.test(image);
}

function validSha(sha) {
  return typeof sha === 'string' && /^[a-f0-9]{40}$/.test(sha);
}

export function dockerPublicationKind({ sha, eventName, ref }) {
  const releaseRef = typeof ref === 'string' && ref.length <= 1024 && ref.startsWith('refs/tags/v')
    && !/[\u0000-\u0020\u007f/]/.test(ref.slice('refs/tags/'.length));
  if (!validSha(sha) || eventName !== 'push' || (ref !== 'refs/heads/main' && !releaseRef)) {
    throw new Error('Unsupported Docker publication event or ref');
  }
  return ref === 'refs/heads/main' ? 'main' : 'release';
}

export function dockerPrebuildDecision(input) {
  if (dockerPublicationKind(input) === 'release') return 'build';
  if (!validSha(input.currentMainSha)) throw new Error('Invalid Docker prebuild provenance');
  return input.sha === input.currentMainSha ? 'build' : 'skip-obsolete-main';
}

export function splitDockerPublishTags({ image, metadataTags, sha, eventName, ref }) {
  const kind = dockerPublicationKind({ sha, eventName, ref });
  if (!validImage(image) || !validSha(sha) || typeof metadataTags !== 'string' || metadataTags.length > 4096) {
    throw new Error('Invalid Docker publication metadata');
  }
  const tags = metadataTags.split('\n').filter(Boolean);
  if (!tags.length || tags.length > 16 || new Set(tags).size !== tags.length || tags.some(tag => {
    const suffix = tag.slice(image.length + 1);
    return !tag.startsWith(`${image}:`) || !/^[\w][\w.-]{0,127}$/.test(suffix);
  }) || !tags.includes(`${image}:sha-${sha.slice(0, 7)}`)) {
    throw new Error('Invalid Docker publication tags');
  }
  // Deliberate v* release metadata (including implicit latest) keeps its old semantics.
  if (kind === 'release') return { buildTags: tags, movingTags: [] };
  const movingTags = tags.filter(tag => tag === `${image}:main` || tag === `${image}:latest`);
  return { buildTags: tags.filter(tag => !movingTags.includes(tag)), movingTags };
}

export function movingTagPromotionArgs({ image, metadataTags, sha, eventName, ref, currentMainSha, digest }) {
  const { movingTags } = splitDockerPublishTags({ image, metadataTags, sha, eventName, ref });
  if (!movingTags.length) return [];
  if (!validSha(currentMainSha) || typeof digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(digest)) {
    throw new Error('Invalid Docker promotion provenance');
  }
  if (sha !== currentMainSha) return [];
  // One OCI index source, no platform filter/annotation: copy the complete index.
  return ['buildx', 'imagetools', 'create', ...movingTags.flatMap(tag => ['--tag', tag]), `${image}@${digest}`];
}
