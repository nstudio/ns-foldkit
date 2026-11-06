import type { NativeBackend } from './backend';
import {
  CommentShim,
  CustomEventShim,
  DocumentFragmentShim,
  DocumentShim,
  ElementShim,
  EventShim,
  NodeShim,
  TextShim,
} from './dom';

const noop = () => {};

const mediaQueryList = (query: string) => ({
  media: query,
  matches: false,
  onchange: null,
  addEventListener: noop,
  removeEventListener: noop,
  addListener: noop,
  removeListener: noop,
  dispatchEvent: () => false,
});

const memoryStorage = () => {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: (index: number) => [...items.keys()][index] ?? null,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, String(value)),
    removeItem: (key: string) => void items.delete(key),
    clear: () => items.clear(),
  };
};

class MutationObserverShim {
  observe(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

class MessagePortShim {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  _peer: MessagePortShim | undefined = undefined;
  private isClosed = false;

  postMessage(data: unknown): void {
    const peer = this._peer;
    if (this.isClosed || peer === undefined) {
      return;
    }
    // A macrotask, like the real channel: Foldkit defers long message drains
    // through it so rendering and native input get a turn in between.
    setTimeout(() => {
      if (!peer.isClosed) {
        peer.onmessage?.({ data });
      }
    }, 0);
  }

  close(): void {
    this.isClosed = true;
  }

  start(): void {}
}

class MessageChannelShim {
  readonly port1 = new MessagePortShim();
  readonly port2 = new MessagePortShim();

  constructor() {
    this.port1._peer = this.port2;
    this.port2._peer = this.port1;
  }
}

const defineGlobal =(name: string, value: unknown, { override }: { override: boolean }) => {
  const scope = globalThis as Record<string, unknown>;
  if (override || scope[name] === undefined) {
    scope[name] = value;
  }
};

/**
 * Installs the browser globals Foldkit's runtime and its vendored snabbdom
 * read, backed by `backend`. Must run before any `foldkit` module is
 * evaluated: import it first in the entry file.
 */
export const installDom = (backend: NativeBackend): DocumentShim => {
  const existing = (globalThis as { document?: unknown }).document;
  if (existing instanceof DocumentShim) {
    return existing;
  }

  const document = new DocumentShim(backend);
  const window = globalThis as Record<string, unknown>;
  document.defaultView = window;
  const windowTarget = document.createDocumentFragment();

  const shims: Record<string, unknown> = {
    document,
    window,
    self: window,
    top: window,
    parent: window,
    Node: NodeShim,
    Element: ElementShim,
    HTMLElement: ElementShim,
    SVGElement: ElementShim,
    Text: TextShim,
    Comment: CommentShim,
    DocumentFragment: DocumentFragmentShim,
    Document: DocumentShim,
    Event: EventShim,
    CustomEvent: CustomEventShim,
    MutationObserver: MutationObserverShim,
    location: {
      href: 'app://nativescript/',
      origin: 'app://nativescript',
      protocol: 'app:',
      host: 'nativescript',
      hostname: 'nativescript',
      port: '',
      pathname: '/',
      search: '',
      hash: '',
      reload: noop,
      assign: noop,
      replace: noop,
    },
    history: { length: 1, state: null, pushState: noop, replaceState: noop, back: noop, forward: noop, go: noop },
    matchMedia: mediaQueryList,
    sessionStorage: memoryStorage(),
    scrollX: 0,
    scrollY: 0,
    scrollTo: noop,
    getComputedStyle: (element: ElementShim) => element.style,
    addEventListener: windowTarget.addEventListener.bind(windowTarget),
    removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
    dispatchEvent: windowTarget.dispatchEvent.bind(windowTarget),
  };

  // DOM names are always ours so `instanceof Element` checks agree with the
  // nodes the bridge creates. Timing and storage globals the host may already
  // provide (NativeScript installs requestAnimationFrame) are left alone.
  for (const [name, value] of Object.entries(shims)) {
    defineGlobal(name, value, { override: name !== 'sessionStorage' });
  }
  defineGlobal('MessageChannel', MessageChannelShim, { override: false });
  defineGlobal('queueMicrotask',(callback: () => void) => void Promise.resolve().then(callback), { override: false });
  defineGlobal('requestAnimationFrame', (callback: (time: number) => void) => setTimeout(() => callback(Date.now()), 16), {
    override: false,
  });
  defineGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle), { override: false });

  return document;
};
