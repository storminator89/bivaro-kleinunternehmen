import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import { getSafeLoginCallbackUrl } from '@/lib/login-callback';

const state = vi.hoisted(() => ({
  params: new URLSearchParams(), replace: vi.fn(), signIn: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: state.replace }), useSearchParams: () => state.params }));
vi.mock('next-auth/react', () => ({ signIn: state.signIn }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: vi.fn(),
  useState: (initial: unknown) => [initial, vi.fn()],
}));
import LoginPage from '@/app/login/page';

function findSubmit(node: ReactNode): ((event: { preventDefault: () => void }) => Promise<void>) | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const submit = findSubmit(child);
      if (submit) return submit;
    }
  }
  if (!isValidElement<{ onSubmit?: (event: { preventDefault: () => void }) => Promise<void>; children?: ReactNode }>(node)) return;
  return node.props.onSubmit ?? findSubmit(node.props.children);
}

beforeEach(() => {
  state.params = new URLSearchParams();
  state.replace.mockReset();
  state.signIn.mockReset().mockResolvedValue({ ok: true, error: null });
  vi.stubGlobal('window', { location: { replace: state.replace } });
});

afterEach(() => vi.unstubAllGlobals());

describe('login callback destinations (#20)', () => {
  it.each(['/customers', '/dashboard?tab=incomes&new=1', '/customers?search=A%20B#details'])('preserves safe destination %s', path => {
    expect(getSafeLoginCallbackUrl(path)).toBe(path);
  });

  it.each([
    null, undefined, '', 'https://evil.example/path', '//evil.example', 'javascript:alert(1)',
    '/\\evil.example', '/\n/evil.example', '/..//evil.example', '/%2f%2fevil.example',
    '/%5cevil.example', '/%00evil.example', '/%zz',
  ])('rejects an unsafe or missing destination %s', path => {
    expect(getSafeLoginCallbackUrl(path)).toBe('/dashboard');
  });

  it('passes the safe callback to signIn and starts a fresh document navigation after success', async () => {
    state.params.set('callbackUrl', '/customers?search=Acme#details');
    await findSubmit(LoginPage())!({ preventDefault: vi.fn() });
    expect(state.signIn).toHaveBeenCalledWith('credentials', expect.objectContaining({
      redirect: false, callbackUrl: '/customers?search=Acme#details',
    }));
    expect(state.replace).toHaveBeenCalledWith('/customers?search=Acme#details');
  });

  it('never trusts a returned external signIn URL', async () => {
    state.params.set('callbackUrl', '//evil.example');
    state.signIn.mockResolvedValue({ ok: true, url: 'https://evil.example' });
    await findSubmit(LoginPage())!({ preventDefault: vi.fn() });
    expect(state.replace).toHaveBeenCalledWith('/dashboard');
  });

  it.each([{ ok: false, error: 'CredentialsSignin' }, undefined])('does not navigate after unsuccessful authentication', async result => {
    state.signIn.mockResolvedValue(result);
    await findSubmit(LoginPage())!({ preventDefault: vi.fn() });
    expect(state.replace).not.toHaveBeenCalled();
  });
});
