import type { ChildSlot, EventDetail, NativeBackend } from '../src/foldkit-nativescript/backend';

export class FakeView {
  readonly props: Record<string, unknown> = {};
  readonly style: Record<string, string | undefined> = {};
  readonly children: FakeView[] = [];
  readonly listeners = new Map<string, Set<(detail: EventDetail) => void>>();
  content: FakeView | undefined = undefined;
  text = '';
  className = '';
  parent: FakeView | undefined = undefined;

  constructor(readonly tag: string) {}

  fire(type: string, detail: EventDetail = {}): void {
    for (const emit of this.listeners.get(type) ?? []) {
      emit(detail);
    }
  }

  find(predicate: (view: FakeView) => boolean): FakeView | undefined {
    if (predicate(this)) {
      return this;
    }
    for (const child of [...this.children, ...(this.content ? [this.content] : [])]) {
      const found = child.find(predicate);
      if (found) {
        return found;
      }
    }
    return undefined;
  }

  findAll(predicate: (view: FakeView) => boolean): FakeView[] {
    const own = predicate(this) ? [this] : [];
    const nested = [...this.children, ...(this.content ? [this.content] : [])].flatMap(child =>
      child.findAll(predicate),
    );
    return [...own, ...nested];
  }
}

const VIRTUAL_TAGS = new Set(['html', 'head', 'body', 'foldkit-container']);
const SLOTS: Record<string, ChildSlot> = {
  'ns-root': 'content',
  div: 'layout',
  'ns-stack-layout': 'layout',
  'ns-scroll-view': 'content',
  p: 'text',
  span: 'text',
  button: 'text',
  'ns-label': 'text',
  'ns-button': 'text',
  input: 'text',
};
const KNOWN_PROPERTIES = new Set(['text', 'checked', 'value', 'orientation', 'hint', 'id']);

/** A NativeBackend that records the native tree in plain objects for assertions. */
export const recordingBackend: NativeBackend<FakeView> = {
  createView: tag => (VIRTUAL_TAGS.has(tag) ? undefined : new FakeView(tag)),
  childSlot: view => SLOTS[view.tag] ?? 'none',
  insertChild: (parent, child, index) => {
    if (child.parent !== undefined) {
      throw new Error(`view ${child.tag} already has a parent`);
    }
    parent.children.splice(index, 0, child);
    child.parent = parent;
  },
  removeChild: (parent, child) => {
    parent.children.splice(parent.children.indexOf(child), 1);
    child.parent = undefined;
  },
  setContent: (parent, child) => {
    if (parent.content) {
      parent.content.parent = undefined;
    }
    parent.content = child;
    if (child) {
      child.parent = parent;
    }
  },
  setText: (view, text) => {
    view.text = text;
  },
  hasProperty: (_view, name) => KNOWN_PROPERTIES.has(name),
  getProperty: (view, name) => (name === 'value' ? view.text : view.props[name]),
  setProperty: (view, name, value) => {
    if (name === 'value') {
      view.text = String(value);
    } else {
      view.props[name] = value;
    }
  },
  setAttribute: (view, name, value) => {
    view.props[name] = value;
  },
  removeAttribute: (view, name) => {
    delete view.props[name];
  },
  setClassName: (view, className) => {
    view.className = className;
  },
  setStyle: (view, name, value) => {
    view.style[name] = value;
  },
  listen: (view, type, emit) => {
    const listeners = view.listeners.get(type) ?? new Set();
    view.listeners.set(type, listeners);
    listeners.add(emit);
    return () => listeners.delete(emit);
  },
  focus: () => {},
  blur: () => {},
};
