/**
 * The seam between the DOM bridge and a native view toolkit. The bridge owns
 * the DOM-shaped tree Foldkit's patcher walks; a backend owns the native views
 * that tree mirrors. Keeping NativeScript behind this interface lets the
 * bridge run under Node with a recording backend.
 */
export type ChildSlot =
  /** Children become native children in DOM order (layouts). */
  | 'layout'
  /** The first element child becomes the single native content view. */
  | 'content'
  /** Descendant text is concatenated into the view's text. */
  | 'text'
  /** Children have no native representation. */
  | 'none';

export type EventDetail = Record<string, unknown>;

export interface NativeBackend<View = unknown> {
  /**
   * Returns the native view for a tag, or `undefined` for tags that exist only
   * in the DOM tree (mount containers). Throws for tags it does not know.
   */
  createView(tagName: string): View | undefined;
  childSlot(view: View): ChildSlot;
  insertChild(parent: View, child: View, index: number): void;
  removeChild(parent: View, child: View): void;
  setContent(parent: View, child: View | undefined): void;
  setText(view: View, text: string): void;

  hasProperty(view: View, name: string): boolean;
  getProperty(view: View, name: string): unknown;
  setProperty(view: View, name: string, value: unknown): void;

  /** `name` arrives lowercased: Foldkit normalizes attribute names as HTML does. */
  setAttribute(view: View, name: string, value: string): void;
  removeAttribute(view: View, name: string): void;
  setClassName(view: View, className: string): void;
  setStyle(view: View, cssName: string, value: string | undefined): void;

  /**
   * Subscribes to the native event a DOM event type maps to. Returns the
   * unsubscribe function, or `undefined` when the view has no such event.
   */
  listen(view: View, type: string, emit: (detail: EventDetail) => void): (() => void) | undefined;

  focus(view: View): void;
  blur(view: View): void;
}
