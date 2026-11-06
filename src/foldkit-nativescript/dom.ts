import type { ChildSlot, EventDetail, NativeBackend } from './backend';

export const ELEMENT_NODE = 1;
export const TEXT_NODE = 3;
export const COMMENT_NODE = 8;
export const DOCUMENT_NODE = 9;
export const DOCUMENT_FRAGMENT_NODE = 11;

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

type Listener = ((event: EventShim) => void) | { handleEvent(event: EventShim): void };

interface ListenerEntry {
  readonly listeners: Set<Listener>;
  readonly unsubscribe: (() => void) | undefined;
}

export class EventShim {
  readonly type: string;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  readonly timeStamp = Date.now();
  readonly isTrusted = true;
  defaultPrevented = false;
  target: NodeShim | null = null;
  currentTarget: NodeShim | null = null;
  _isPropagationStopped = false;
  _isImmediatePropagationStopped = false;

  constructor(type: string, init: { bubbles?: boolean; cancelable?: boolean } = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? false;
    this.cancelable = init.cancelable ?? false;
  }

  preventDefault(): void {
    if (this.cancelable) {
      this.defaultPrevented = true;
    }
  }

  stopPropagation(): void {
    this._isPropagationStopped = true;
  }

  stopImmediatePropagation(): void {
    this._isPropagationStopped = true;
    this._isImmediatePropagationStopped = true;
  }

  composedPath(): NodeShim[] {
    const path: NodeShim[] = [];
    for (let node = this.target; node !== null; node = node.parentNode) {
      path.push(node);
    }
    return path;
  }
}

export class CustomEventShim<Detail = unknown> extends EventShim {
  readonly detail: Detail;

  constructor(type: string, init: { bubbles?: boolean; cancelable?: boolean; detail?: Detail } = {}) {
    super(type, init);
    this.detail = init.detail as Detail;
  }
}

export abstract class NodeShim {
  abstract readonly nodeType: number;
  abstract readonly nodeName: string;
  parentNode: NodeShim | null = null;
  readonly childNodes: NodeShim[] = [];
  _listeners: Map<string, ListenerEntry> | undefined = undefined;

  constructor(readonly ownerDocument: DocumentShim | null) {}

  get firstChild(): NodeShim | null {
    return this.childNodes[0] ?? null;
  }

  get lastChild(): NodeShim | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  get nextSibling(): NodeShim | null {
    const siblings = this.parentNode?.childNodes;
    return siblings === undefined ? null : (siblings[siblings.indexOf(this) + 1] ?? null);
  }

  get previousSibling(): NodeShim | null {
    const siblings = this.parentNode?.childNodes;
    return siblings === undefined ? null : (siblings[siblings.indexOf(this) - 1] ?? null);
  }

  get parentElement(): ElementShim | null {
    return this.parentNode instanceof ElementShim ? this.parentNode : null;
  }

  get isConnected(): boolean {
    return this.getRootNode().nodeType === DOCUMENT_NODE;
  }

  get nodeValue(): string | null {
    return null;
  }

  get textContent(): string | null {
    let text = '';
    for (const child of this.childNodes) {
      if (child.nodeType !== COMMENT_NODE) {
        text += child.textContent ?? '';
      }
    }
    return text;
  }

  set textContent(text: string | null) {
    this.replaceChildren();
    if (text !== null && text !== '' && this.ownerDocument !== null) {
      this.appendChild(this.ownerDocument.createTextNode(text));
    }
  }

  getRootNode(): NodeShim {
    let node: NodeShim = this;
    while (node.parentNode !== null) {
      node = node.parentNode;
    }
    return node;
  }

  hasChildNodes(): boolean {
    return this.childNodes.length > 0;
  }

  contains(other: NodeShim | null): boolean {
    for (let node = other; node !== null; node = node.parentNode) {
      if (node === this) {
        return true;
      }
    }
    return false;
  }

  appendChild<T extends NodeShim>(child: T): T {
    return this.insertBefore(child, null);
  }

  insertBefore<T extends NodeShim>(child: T, reference: NodeShim | null): T {
    if (child.nodeType === DOCUMENT_FRAGMENT_NODE) {
      for (const fragmentChild of [...child.childNodes]) {
        this.insertBefore(fragmentChild, reference);
      }
      return child;
    }
    if (reference !== null && reference.parentNode !== this) {
      throw new Error('[foldkit-nativescript] insertBefore: reference node is not a child of this node.');
    }
    if (child.contains(this)) {
      throw new Error('[foldkit-nativescript] insertBefore: a node cannot be inserted into its own subtree.');
    }
    const effectiveReference = reference === child ? child.nextSibling : reference;
    if (child.parentNode !== null) {
      child.parentNode.removeChild(child);
    }
    const index =
      effectiveReference === null ? this.childNodes.length : this.childNodes.indexOf(effectiveReference);
    this.childNodes.splice(index, 0, child);
    child.parentNode = this;
    this._onChildInserted(child);
    return child;
  }

  removeChild<T extends NodeShim>(child: T): T {
    const index = this.childNodes.indexOf(child);
    if (index === -1) {
      throw new Error('[foldkit-nativescript] removeChild: node is not a child of this node.');
    }
    this.childNodes.splice(index, 1);
    child.parentNode = null;
    this._onChildRemoved(child);
    return child;
  }

  replaceChild<T extends NodeShim>(newChild: NodeShim, oldChild: T): T {
    if (newChild === oldChild) {
      return oldChild;
    }
    this.insertBefore(newChild, oldChild);
    return this.removeChild(oldChild);
  }

  replaceChildren(...nodes: NodeShim[]): void {
    for (const child of [...this.childNodes]) {
      this.removeChild(child);
    }
    for (const node of nodes) {
      this.appendChild(node);
    }
  }

  remove(): void {
    this.parentNode?.removeChild(this);
  }

  addEventListener(type: string, listener: Listener | null): void {
    if (listener === null || listener === undefined) {
      return;
    }
    this._listeners ??= new Map();
    let entry = this._listeners.get(type);
    if (entry === undefined) {
      entry = { listeners: new Set(), unsubscribe: this._listenNative(type) };
      this._listeners.set(type, entry);
    }
    entry.listeners.add(listener);
  }

  removeEventListener(type: string, listener: Listener | null): void {
    const entry = this._listeners?.get(type);
    if (entry === undefined || listener === null) {
      return;
    }
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0) {
      entry.unsubscribe?.();
      this._listeners!.delete(type);
    }
  }

  dispatchEvent(event: EventShim): boolean {
    event.target ??= this;
    const path = event.bubbles ? event.composedPath() : [this];
    for (const node of path) {
      event.currentTarget = node;
      node._invokeListeners(event);
      if (event._isPropagationStopped) {
        break;
      }
    }
    event.currentTarget = null;
    return !event.defaultPrevented;
  }

  _invokeListeners(event: EventShim): void {
    const entry = this._listeners?.get(event.type);
    if (entry === undefined) {
      return;
    }
    for (const listener of [...entry.listeners]) {
      if (typeof listener === 'function') {
        listener.call(this, event);
      } else {
        listener.handleEvent(event);
      }
      if (event._isImmediatePropagationStopped) {
        return;
      }
    }
  }

  _listenNative(_type: string): (() => void) | undefined {
    return undefined;
  }

  _onChildInserted(_child: NodeShim): void {}

  _onChildRemoved(_child: NodeShim): void {}

  _onDescendantTextChanged(): void {}
}

abstract class CharacterDataShim extends NodeShim {
  private _data: string;

  constructor(ownerDocument: DocumentShim, data: string) {
    super(ownerDocument);
    this._data = String(data);
  }

  get data(): string {
    return this._data;
  }

  set data(value: string) {
    this._data = String(value);
    if (this.nodeType === TEXT_NODE) {
      this.parentNode?._onDescendantTextChanged();
    }
  }

  get length(): number {
    return this._data.length;
  }

  override get nodeValue(): string {
    return this._data;
  }

  override set nodeValue(value: string) {
    this.data = value;
  }

  override get textContent(): string {
    return this._data;
  }

  override set textContent(value: string) {
    this.data = value;
  }
}

export class TextShim extends CharacterDataShim {
  readonly nodeType = TEXT_NODE;
  readonly nodeName = '#text';
}

export class CommentShim extends CharacterDataShim {
  readonly nodeType = COMMENT_NODE;
  readonly nodeName = '#comment';
}

export class DocumentFragmentShim extends NodeShim {
  readonly nodeType = DOCUMENT_FRAGMENT_NODE;
  readonly nodeName = '#document-fragment';
}

const CLASS_SEPARATOR = /[\t\n\f\r ]+/;

const splitClassNames = (value: string): string[] => value.split(CLASS_SEPARATOR).filter(name => name !== '');

class ClassListShim {
  constructor(private readonly element: ElementShim) {}

  private read(): string[] {
    return splitClassNames(this.element.getAttribute('class') ?? '');
  }

  private write(names: string[]): void {
    this.element.setAttribute('class', names.join(' '));
  }

  get length(): number {
    return this.read().length;
  }

  get value(): string {
    return this.element.getAttribute('class') ?? '';
  }

  item(index: number): string | null {
    return this.read()[index] ?? null;
  }

  contains(name: string): boolean {
    return this.read().includes(name);
  }

  add(...names: string[]): void {
    const current = this.read();
    const additions = names.filter(name => !current.includes(name));
    if (additions.length > 0) {
      this.write([...current, ...additions]);
    }
  }

  remove(...names: string[]): void {
    const current = this.read();
    const next = current.filter(name => !names.includes(name));
    if (next.length !== current.length) {
      this.write(next);
    }
  }

  toggle(name: string, force?: boolean): boolean {
    const shouldHave = force ?? !this.contains(name);
    if (shouldHave) {
      this.add(name);
    } else {
      this.remove(name);
    }
    return shouldHave;
  }
}

const parseCssText = (cssText: string): Array<[string, string]> =>
  cssText
    .split(';')
    .map(declaration => {
      const colon = declaration.indexOf(':');
      return colon === -1
        ? undefined
        : ([declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()] as [string, string]);
    })
    .filter((entry): entry is [string, string] => entry !== undefined && entry[0] !== '');

class StyleShim {
  private readonly values = new Map<string, string>();

  constructor(private readonly element: ElementShim) {}

  getPropertyValue(name: string): string {
    return this.values.get(name) ?? '';
  }

  setProperty(name: string, value: string | null): void {
    if (value === null || value === '') {
      this.removeProperty(name);
      return;
    }
    this.values.set(name, String(value));
    this.element._applyStyle(name, String(value));
  }

  removeProperty(name: string): string {
    const previous = this.values.get(name) ?? '';
    if (this.values.delete(name)) {
      this.element._applyStyle(name, undefined);
    }
    return previous;
  }

  get length(): number {
    return this.values.size;
  }

  get cssText(): string {
    return [...this.values].map(([name, value]) => `${name}: ${value}`).join('; ');
  }

  set cssText(cssText: string) {
    for (const name of [...this.values.keys()]) {
      this.removeProperty(name);
    }
    for (const [name, value] of parseCssText(cssText)) {
      this.setProperty(name, value);
    }
  }
}

interface SimpleSelector {
  readonly tag?: string;
  readonly id?: string;
  readonly classes: string[];
  readonly attributes: Array<{ name: string; value?: string }>;
}

const SELECTOR_TOKEN = /([#.]?)([\w-]+)|\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/g;

const parseSimpleSelector = (selector: string): SimpleSelector => {
  const parsed: { tag?: string; id?: string; classes: string[]; attributes: Array<{ name: string; value?: string }> } =
    { classes: [], attributes: [] };
  for (const match of selector.trim().matchAll(SELECTOR_TOKEN)) {
    const [, prefix, name, attributeName, attributeValue] = match;
    if (attributeName !== undefined) {
      parsed.attributes.push({ name: attributeName.toLowerCase(), value: attributeValue });
    } else if (prefix === '#') {
      parsed.id = name;
    } else if (prefix === '.') {
      parsed.classes.push(name!);
    } else {
      parsed.tag = name!.toLowerCase();
    }
  }
  return parsed;
};

const matchesSimpleSelector = (element: ElementShim, selector: SimpleSelector): boolean =>
  (selector.tag === undefined || selector.tag === '*' || element.localName === selector.tag) &&
  (selector.id === undefined || element.id === selector.id) &&
  selector.classes.every(name => element.classList.contains(name)) &&
  selector.attributes.every(({ name, value }) =>
    value === undefined ? element.hasAttribute(name) : element.getAttribute(name) === value,
  );

/** Supports comma-separated compound selectors (`tag#id.class[attr=value]`); combinators are not supported. */
const matchesSelector = (element: ElementShim, selector: string): boolean =>
  selector.split(',').some(part => matchesSimpleSelector(element, parseSimpleSelector(part)));

function* descendantElements(node: NodeShim): Generator<ElementShim> {
  for (const child of node.childNodes) {
    if (child instanceof ElementShim) {
      yield child;
    }
    yield* descendantElements(child);
  }
}

/**
 * Elements are returned wrapped in a Proxy so that property writes Foldkit's
 * props module makes (`elm.text = ...`, `elm.checked = ...`) and reads
 * (`elm.value`) reach the native view. Members declared on this class win;
 * everything else is forwarded when the backend says the view has it, and
 * stored as an expando otherwise.
 */
const elementProxyHandler: ProxyHandler<ElementShim> = {
  get(target, key, receiver) {
    if (typeof key === 'symbol' || key in target) {
      return Reflect.get(target, key, receiver);
    }
    const view = target._view;
    if (view !== undefined && target._backend.hasProperty(view, key)) {
      return target._backend.getProperty(view, key);
    }
    return undefined;
  },
  set(target, key, value, receiver) {
    if (typeof key !== 'symbol' && !(key in target)) {
      const view = target._view;
      if (view !== undefined && target._backend.hasProperty(view, key)) {
        target._backend.setProperty(view, key, value);
        return true;
      }
    }
    return Reflect.set(target, key, value, receiver);
  },
  has(target, key) {
    if (key in target) {
      return true;
    }
    const view = target._view;
    return typeof key === 'string' && view !== undefined && target._backend.hasProperty(view, key);
  },
};

export class ElementShim extends NodeShim {
  readonly nodeType = ELEMENT_NODE;
  readonly namespaceURI: string = HTML_NAMESPACE;
  readonly localName: string;
  readonly dataset: Record<string, string> = {};
  readonly _backend: NativeBackend;
  readonly _view: unknown;
  readonly _slot: ChildSlot;
  private readonly _attributes = new Map<string, string>();
  private _classList: ClassListShim | undefined = undefined;
  private _style: StyleShim | undefined = undefined;
  private _contentView: unknown = undefined;
  private _syncedText: string | undefined = undefined;

  constructor(ownerDocument: DocumentShim, tagName: string) {
    super(ownerDocument);
    this.localName = tagName.toLowerCase();
    this._backend = ownerDocument._backend;
    this._view = this._backend.createView(this.localName);
    this._slot = this._view === undefined ? 'none' : this._backend.childSlot(this._view);
    return new Proxy(this, elementProxyHandler);
  }

  get nodeName(): string {
    return this.tagName;
  }

  get tagName(): string {
    return this.localName.toUpperCase();
  }

  /** The native view backing this element, or `undefined` for DOM-only elements. */
  get nativeView(): unknown {
    return this._view;
  }

  get children(): ElementShim[] {
    return this.childNodes.filter((child): child is ElementShim => child instanceof ElementShim);
  }

  get childElementCount(): number {
    return this.children.length;
  }

  get firstElementChild(): ElementShim | null {
    return this.children[0] ?? null;
  }

  get lastElementChild(): ElementShim | null {
    const { children } = this;
    return children[children.length - 1] ?? null;
  }

  get id(): string {
    return this.getAttribute('id') ?? '';
  }

  set id(value: string) {
    this.setAttribute('id', value);
  }

  get className(): string {
    return this.getAttribute('class') ?? '';
  }

  set className(value: string) {
    this.setAttribute('class', value);
  }

  get classList(): ClassListShim {
    return (this._classList ??= new ClassListShim(this));
  }

  get style(): StyleShim {
    return (this._style ??= new StyleShim(this));
  }

  get attributes(): Array<{ name: string; value: string }> {
    return [...this._attributes].map(([name, value]) => ({ name, value }));
  }

  getAttribute(name: string): string | null {
    return this._attributes.get(name.toLowerCase()) ?? null;
  }

  getAttributeNames(): string[] {
    return [...this._attributes.keys()];
  }

  hasAttribute(name: string): boolean {
    return this._attributes.has(name.toLowerCase());
  }

  hasAttributes(): boolean {
    return this._attributes.size > 0;
  }

  setAttribute(name: string, value: unknown): void {
    const lowerName = name.toLowerCase();
    const stringValue = String(value);
    this._attributes.set(lowerName, stringValue);
    if (lowerName === 'style') {
      this.style.cssText = stringValue;
      return;
    }
    if (this._view === undefined || lowerName.startsWith('data-')) {
      return;
    }
    if (lowerName === 'class') {
      this._backend.setClassName(this._view, stringValue);
    } else {
      this._backend.setAttribute(this._view, lowerName, stringValue);
    }
  }

  removeAttribute(name: string): void {
    const lowerName = name.toLowerCase();
    if (!this._attributes.delete(lowerName)) {
      return;
    }
    if (lowerName === 'style') {
      this.style.cssText = '';
      return;
    }
    if (this._view === undefined || lowerName.startsWith('data-')) {
      return;
    }
    if (lowerName === 'class') {
      this._backend.setClassName(this._view, '');
    } else {
      this._backend.removeAttribute(this._view, lowerName);
    }
  }

  toggleAttribute(name: string, force?: boolean): boolean {
    const shouldHave = force ?? !this.hasAttribute(name);
    if (shouldHave) {
      this.setAttribute(name, '');
    } else {
      this.removeAttribute(name);
    }
    return shouldHave;
  }

  setAttributeNS(_namespace: string | null, name: string, value: unknown): void {
    this.setAttribute(name.slice(name.indexOf(':') + 1), value);
  }

  removeAttributeNS(_namespace: string | null, localName: string): void {
    this.removeAttribute(localName);
  }

  matches(selector: string): boolean {
    return matchesSelector(this, selector);
  }

  closest(selector: string): ElementShim | null {
    for (let node: NodeShim | null = this; node !== null; node = node.parentNode) {
      if (node instanceof ElementShim && node.matches(selector)) {
        return node;
      }
    }
    return null;
  }

  querySelector(selector: string): ElementShim | null {
    for (const element of descendantElements(this)) {
      if (element.matches(selector)) {
        return element;
      }
    }
    return null;
  }

  querySelectorAll(selector: string): ElementShim[] {
    return [...descendantElements(this)].filter(element => element.matches(selector));
  }

  getElementsByTagName(tagName: string): ElementShim[] {
    return this.querySelectorAll(tagName);
  }

  focus(): void {
    if (this._view !== undefined) {
      this._backend.focus(this._view);
    }
    if (this.ownerDocument !== null) {
      this.ownerDocument.activeElement = this;
    }
  }

  blur(): void {
    if (this._view !== undefined) {
      this._backend.blur(this._view);
    }
    if (this.ownerDocument?.activeElement === this) {
      this.ownerDocument.activeElement = null;
    }
  }

  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }

  _applyStyle(cssName: string, value: string | undefined): void {
    if (this._view !== undefined) {
      this._backend.setStyle(this._view, cssName, value);
    }
  }

  override _listenNative(type: string): (() => void) | undefined {
    if (this._view === undefined) {
      return undefined;
    }
    return this._backend.listen(this._view, type, (detail: EventDetail) => {
      this.dispatchEvent(new CustomEventShim(type, { detail, cancelable: true }));
    });
  }

  override _onChildInserted(child: NodeShim): void {
    if (this._slot === 'layout' && child instanceof ElementShim && child._view !== undefined) {
      this._backend.insertChild(this._view, child._view, this._nativeIndexOf(child));
    } else if (this._slot === 'content') {
      this._syncContent();
    }
    this._onDescendantTextChanged();
  }

  override _onChildRemoved(child: NodeShim): void {
    if (this._slot === 'layout' && child instanceof ElementShim && child._view !== undefined) {
      this._backend.removeChild(this._view, child._view);
    } else if (this._slot === 'content') {
      this._syncContent();
    }
    this._onDescendantTextChanged();
  }

  override _onDescendantTextChanged(): void {
    if (this._slot !== 'text') {
      return;
    }
    const text = this.textContent ?? '';
    if (text !== this._syncedText) {
      this._syncedText = text;
      this._backend.setText(this._view, text);
    }
    this.parentNode?._onDescendantTextChanged();
  }

  private _nativeIndexOf(child: ElementShim): number {
    let index = 0;
    for (const sibling of this.childNodes) {
      if (sibling === child) {
        return index;
      }
      if (sibling instanceof ElementShim && sibling._view !== undefined) {
        index++;
      }
    }
    return index;
  }

  private _syncContent(): void {
    const contentElement = this.childNodes.find(
      (child): child is ElementShim => child instanceof ElementShim && child._view !== undefined,
    );
    const contentView = contentElement?._view;
    if (contentView !== this._contentView) {
      this._contentView = contentView;
      this._backend.setContent(this._view, contentView);
    }
  }
}

export class DocumentShim extends NodeShim {
  readonly nodeType = DOCUMENT_NODE;
  readonly nodeName = '#document';
  readonly readyState = 'complete';
  readonly visibilityState = 'visible';
  readonly hidden = false;
  readonly documentElement: ElementShim;
  readonly head: ElementShim;
  readonly body: ElementShim;
  activeElement: ElementShim | null = null;
  defaultView: unknown = undefined;
  title = '';

  constructor(readonly _backend: NativeBackend) {
    super(null);
    this.documentElement = this.createElement('html');
    this.head = this.createElement('head');
    this.body = this.createElement('body');
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }

  override get textContent(): null {
    return null;
  }

  override set textContent(_value: string | null) {}

  createElement(tagName: string): ElementShim {
    return new ElementShim(this, tagName);
  }

  createElementNS(_namespace: string | null, qualifiedName: string): ElementShim {
    return new ElementShim(this, qualifiedName);
  }

  createTextNode(data: string): TextShim {
    return new TextShim(this, data);
  }

  createComment(data: string): CommentShim {
    return new CommentShim(this, data);
  }

  createDocumentFragment(): DocumentFragmentShim {
    return new DocumentFragmentShim(this);
  }

  createEvent(): EventShim {
    return new EventShim('');
  }

  getElementById(id: string): ElementShim | null {
    for (const element of descendantElements(this)) {
      if (element.id === id) {
        return element;
      }
    }
    return null;
  }

  querySelector(selector: string): ElementShim | null {
    return this.documentElement.matches(selector) ? this.documentElement : this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector: string): ElementShim[] {
    return [
      ...(this.documentElement.matches(selector) ? [this.documentElement] : []),
      ...this.documentElement.querySelectorAll(selector),
    ];
  }

  hasFocus(): boolean {
    return true;
  }
}
