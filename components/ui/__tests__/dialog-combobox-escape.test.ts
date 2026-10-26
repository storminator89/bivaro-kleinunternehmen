import { Children, isValidElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DialogContent } from '../dialog';

/** Narrow handler contract only; real DOM/capture order is covered by the
 * separately authored hosted browser journey, not these interface stubs. */
function escapeHandler(onEscapeKeyDown = vi.fn()) {
  const tree = DialogContent({ onEscapeKeyDown });
  const content = Children.toArray(tree.props.children).find(child =>
    isValidElement<{ onEscapeKeyDown?: unknown }>(child) && typeof child.props.onEscapeKeyDown === 'function');
  if (!isValidElement<{ onEscapeKeyDown: (event: KeyboardEvent) => void }>(content)) throw new Error('Dialog content is missing its Escape handler.');
  return { handle: content.props.onEscapeKeyDown, caller: onEscapeKeyDown };
}

afterEach(() => vi.unstubAllGlobals());

describe('inline combobox Escape handoff to Radix Dialog', () => {
  it('calls the existing caller and protects only the explicitly expanded inline combobox target', () => {
    const matches = vi.fn(() => true);
    class ElementStub { matches = matches; }
    vi.stubGlobal('Element', ElementStub);
    const { handle, caller } = escapeHandler();
    const event = { target: new ElementStub(), preventDefault: vi.fn() } as unknown as KeyboardEvent;
    handle(event);
    expect(caller).toHaveBeenCalledExactlyOnceWith(event);
    expect(matches).toHaveBeenCalledExactlyOnceWith('[role="combobox"][data-inline-combobox="true"][aria-expanded="true"]');
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it('leaves second Escape, ordinary dialog targets and other comboboxes dismissible', () => {
    class ElementStub { matches = vi.fn(() => false); }
    vi.stubGlobal('Element', ElementStub);
    const { handle, caller } = escapeHandler();
    for (const target of [new ElementStub(), null, new EventTarget()]) {
      const event = { target, preventDefault: vi.fn() } as unknown as KeyboardEvent;
      handle(event);
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
    expect(caller).toHaveBeenCalledTimes(3);
  });

  it('preserves caller-owned cancellation on ordinary dialog targets', () => {
    class ElementStub { matches = vi.fn(() => false); }
    vi.stubGlobal('Element', ElementStub);
    const { handle } = escapeHandler(vi.fn(event => event.preventDefault()));
    const event = { target: new ElementStub(), preventDefault: vi.fn() } as unknown as KeyboardEvent;
    handle(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
});
