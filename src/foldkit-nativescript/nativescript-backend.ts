import {
  AbsoluteLayout,
  ActivityIndicator,
  Button,
  ContentView,
  DatePicker,
  DockLayout,
  EditableTextBase,
  EventData,
  FlexboxLayout,
  GridLayout,
  HtmlView,
  Image,
  Label,
  LayoutBase,
  ListPicker,
  Placeholder,
  Progress,
  ScrollView,
  SearchBar,
  SegmentedBar,
  Slider,
  StackLayout,
  Switch,
  TextBase,
  TextField,
  TextView,
  TimePicker,
  View,
  WebView,
  WrapLayout,
  unsetValue,
} from '@nativescript/core';

import type { ChildSlot, EventDetail, NativeBackend } from './backend';
import { CONTAINER_TAG, ROOT_TAG } from './mount-point';

export type ViewFactory = () => View;

interface Registration {
  readonly create: ViewFactory;
  /** Class applied under the user's classes, so CSS can target HTML aliases (`.h1`, `.p`). */
  readonly defaultClass?: string;
}

/** Tags that live only in the DOM tree and never get a native view. */
const DOM_ONLY_TAGS = new Set(['html', 'head', 'body', CONTAINER_TAG]);

/** `ns-stack-layout`, `ns-stacklayout` and `stacklayout` all resolve to the same key. */
const registryKey = (tagName: string) => tagName.toLowerCase().replace(/^ns-/, '').replace(/-/g, '');

const registry = new Map<string, Registration>();

/**
 * Registers a native view for a tag, e.g. a plugin view:
 * `registerElement('ns-lottie', () => new LottieView())`.
 */
export const registerElement = (tagName: string, create: ViewFactory, options: { defaultClass?: string } = {}) => {
  registry.set(registryKey(tagName), { create, ...options });
};

// Built from constructors and widened once: under iOS module resolution some
// core view classes are not structurally assignable to `View` (their
// symbol-keyed native setters differ), though every one is a View at runtime.
const fromClass =
  (ViewClass: new () => object, configure?: (view: View) => void): ViewFactory =>
  () => {
    const view = new ViewClass() as View;
    configure?.(view);
    return view;
  };

const coreViews: Record<string, new () => object> = {
  AbsoluteLayout,
  ActivityIndicator,
  Button,
  ContentView,
  DatePicker,
  DockLayout,
  FlexboxLayout,
  GridLayout,
  HtmlView,
  Image,
  Label,
  ListPicker,
  Placeholder,
  Progress,
  ScrollView,
  SearchBar,
  Slider,
  StackLayout,
  Switch,
  TextField,
  TextView,
  TimePicker,
  WebView,
  WrapLayout,
};
for (const [name, ViewClass] of Object.entries(coreViews)) {
  registerElement(name, fromClass(ViewClass));
}
// Containers default to androidOverflowEdge 'ignore'; a root that is not a Page
// must opt in to padding for Android's edge-to-edge system bars.
registerElement(
  ROOT_TAG,
  fromClass(ContentView, view => {
    view.androidOverflowEdge = 'none';
  }),
);

const wrappingLabel = fromClass(Label, view => {
  (view as unknown as Label).textWrap = true;
});
const htmlAliases: Record<string, ViewFactory> = {
  ...Object.fromEntries(
    ['div', 'section', 'main', 'header', 'footer', 'nav', 'article', 'aside', 'form', 'ul', 'ol', 'li'].map(tag => [
      tag,
      fromClass(StackLayout),
    ]),
  ),
  ...Object.fromEntries(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(tag => [tag, wrappingLabel])),
  ...Object.fromEntries(['span', 'label', 'strong', 'em', 'small', 'code', 'a'].map(tag => [tag, fromClass(Label)])),
  button: fromClass(Button),
  input: fromClass(TextField),
  textarea: fromClass(TextView),
  img: fromClass(Image),
};
for (const [tag, create] of Object.entries(htmlAliases)) {
  registerElement(tag, create, { defaultClass: tag });
}

const defaultClasses = new WeakMap<View, string>();

const isEditable = (view: View): boolean => view instanceof EditableTextBase || view instanceof SearchBar;

const parseBooleanAttribute = (value: unknown) =>
  typeof value === 'string' ? value !== 'false' : Boolean(value);

interface Alias {
  readonly applies: (view: View) => boolean;
  readonly get: (view: View) => unknown;
  readonly set: (view: View, value: unknown) => void;
}

/** HTML property names Foldkit's typed builders write, translated to NativeScript's. */
const aliases: Record<string, Alias> = {
  value: {
    applies: isEditable,
    get: view => (view as TextBase).text ?? '',
    set: (view, value) => {
      (view as TextBase).text = value === undefined || value === null ? '' : String(value);
    },
  },
  placeholder: {
    applies: isEditable,
    get: view => (view as EditableTextBase).hint,
    set: (view, value) => {
      (view as EditableTextBase).hint = String(value ?? '');
    },
  },
  disabled: {
    applies: () => true,
    get: view => !view.isEnabled,
    set: (view, value) => {
      view.isEnabled = !parseBooleanAttribute(value);
    },
  },
  readonly: {
    applies: view => view instanceof EditableTextBase,
    get: view => !(view as EditableTextBase).editable,
    set: (view, value) => {
      (view as EditableTextBase).editable = !parseBooleanAttribute(value);
    },
  },
  hidden: {
    applies: () => true,
    get: view => view.visibility === 'collapse',
    set: (view, value) => {
      view.visibility = parseBooleanAttribute(value) ? 'collapse' : 'visible';
    },
  },
};

const aliasFor = (view: View, name: string): Alias | undefined => {
  const alias = aliases[name];
  return alias !== undefined && alias.applies(view) ? alias : undefined;
};

const lowercaseIndexes = new WeakMap<object, Map<string, string>>();

/**
 * Maps lowercased names to the real (camelCase) member names on a prototype
 * chain, because attribute names reach the backend lowercased.
 */
const lowercaseIndexFor = (instance: object): Map<string, string> => {
  const prototype = Object.getPrototypeOf(instance);
  let index = lowercaseIndexes.get(prototype);
  if (index === undefined) {
    index = new Map();
    for (let current = prototype; current !== null && current !== Object.prototype; current = Object.getPrototypeOf(current)) {
      for (const name of Object.getOwnPropertyNames(current)) {
        const descriptor = Object.getOwnPropertyDescriptor(current, name);
        const isFunctionValue = descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'function';
        if (!isFunctionValue && !index.has(name.toLowerCase())) {
          index.set(name.toLowerCase(), name);
        }
      }
    }
    lowercaseIndexes.set(prototype, index);
  }
  return index;
};

const kebabToCamel = (name: string) => name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

const warnedAttributes = new Set<string>();

const warnUnknownAttribute = (view: View, name: string) => {
  const key = `${view.typeName}:${name}`;
  if (!warnedAttributes.has(key)) {
    warnedAttributes.add(key);
    console.warn(`[foldkit-nativescript] <${view.typeName}> has no property or style matching attribute "${name}".`);
  }
};

const applyAttribute = (view: View, name: string, value: unknown) => {
  const alias = aliasFor(view, name);
  if (alias !== undefined) {
    alias.set(view, value === unsetValue ? false : value);
    return;
  }
  const propertyName = lowercaseIndexFor(view).get(name);
  if (propertyName !== undefined) {
    (view as unknown as Record<string, unknown>)[propertyName] = value;
    return;
  }
  const styleName = lowercaseIndexFor(view.style).get(name.replace(/-/g, ''));
  if (styleName !== undefined) {
    (view.style as unknown as Record<string, unknown>)[styleName] = value;
    return;
  }
  warnUnknownAttribute(view, name);
};

/** DOM event types whose NativeScript name depends on the view. */
const viewDependentEvent = (view: View, type: string): string | undefined => {
  if (type === 'input') {
    if (isEditable(view)) return 'textChange';
    if (view instanceof Switch) return 'checkedChange';
    if (view instanceof Slider) return 'valueChange';
  }
  if (type === 'change') {
    if (view instanceof Switch) return 'checkedChange';
    if (view instanceof Slider) return 'valueChange';
    if (view instanceof ListPicker || view instanceof SegmentedBar) return 'selectedIndexChange';
    if (view instanceof DatePicker) return 'dateChange';
    if (view instanceof TimePicker) return 'timeChange';
    if (isEditable(view)) return 'blur';
  }
  return undefined;
};

const DOM_EVENT_NAMES: Record<string, string> = {
  click: 'tap',
  dblclick: 'doubleTap',
  submit: 'returnPress',
  focusin: 'focus',
  focusout: 'blur',
};

const nativeEventName = (view: View, type: string) =>
  viewDependentEvent(view, type) ?? DOM_EVENT_NAMES[type] ?? kebabToCamel(type);

const DETAIL_FIELDS = ['value', 'oldValue', 'oldIndex', 'newIndex', 'direction', 'deltaX', 'deltaY', 'scale', 'state', 'scrollX', 'scrollY'];

const currentValue = (view: View): unknown => {
  if (isEditable(view)) return (view as TextBase).text ?? '';
  if (view instanceof Switch) return view.checked;
  if (view instanceof Slider || view instanceof Progress) return view.value;
  if (view instanceof ListPicker || view instanceof SegmentedBar) return view.selectedIndex;
  if (view instanceof DatePicker) return view.date;
  if (view instanceof TimePicker) return view.time;
  return undefined;
};

/** Copies the serializable parts of a NativeScript event into a CustomEvent detail. */
const eventDetail = (view: View, args: EventData): EventDetail => {
  const source = args as unknown as Record<string, unknown>;
  const detail: EventDetail = {};
  for (const field of DETAIL_FIELDS) {
    const value = source[field];
    if (value !== undefined && (typeof value !== 'object' || value instanceof Date)) {
      detail[field] = value;
    }
  }
  if (typeof source.newIndex === 'number') {
    detail.value = source.newIndex;
  }
  detail.value ??= currentValue(view);
  return detail;
};

export const nativeScriptBackend: NativeBackend<View> = {
  createView(tagName) {
    if (DOM_ONLY_TAGS.has(tagName)) {
      return undefined;
    }
    const registration = registry.get(registryKey(tagName));
    if (registration === undefined) {
      throw new Error(
        `[foldkit-nativescript] No native view is registered for <${tagName}>. ` +
          `Use an ns-* element or call registerElement('${tagName}', () => new MyView()).`,
      );
    }
    const view = registration.create();
    if (registration.defaultClass !== undefined) {
      defaultClasses.set(view, registration.defaultClass);
      view.className = registration.defaultClass;
    }
    return view;
  },

  childSlot(view): ChildSlot {
    if (view instanceof LayoutBase) return 'layout';
    if (view instanceof ContentView) return 'content';
    if (view instanceof TextBase) return 'text';
    return 'none';
  },

  insertChild(parent, child, index) {
    (parent as LayoutBase).insertChild(child, index);
  },

  removeChild(parent, child) {
    (parent as LayoutBase).removeChild(child);
  },

  setContent(parent, child) {
    (parent as ContentView).content = (child ?? null) as View;
  },

  setText(view, text) {
    (view as TextBase).text = text;
  },

  hasProperty(view, name) {
    return aliasFor(view, name) !== undefined || name in view;
  },

  getProperty(view, name) {
    const alias = aliasFor(view, name);
    return alias !== undefined ? alias.get(view) : (view as unknown as Record<string, unknown>)[name];
  },

  setProperty(view, name, value) {
    const alias = aliasFor(view, name);
    if (alias !== undefined) {
      alias.set(view, value);
    } else if ((view as unknown as Record<string, unknown>)[name] !== value) {
      (view as unknown as Record<string, unknown>)[name] = value;
    }
  },

  setAttribute(view, name, value) {
    applyAttribute(view, name, value);
  },

  removeAttribute(view, name) {
    applyAttribute(view, name, unsetValue);
  },

  setClassName(view, className) {
    const defaultClass = defaultClasses.get(view);
    view.className = defaultClass === undefined ? className : `${defaultClass} ${className}`.trim();
  },

  setStyle(view, cssName, value) {
    (view.style as unknown as Record<string, unknown>)[kebabToCamel(cssName)] = value ?? unsetValue;
  },

  listen(view, type, emit) {
    const eventName = nativeEventName(view, type);
    const handler = (args: EventData) => emit(eventDetail(view, args));
    view.on(eventName, handler);
    return () => view.off(eventName, handler);
  },

  focus(view) {
    view.focus();
  },

  blur(view) {
    if (view instanceof EditableTextBase || view instanceof SearchBar) {
      view.dismissSoftInput();
    }
  },
};
