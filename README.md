# Foldkit × NativeScript

Run [Foldkit](https://foldkit.dev) apps (Elm architecture on Effect) on iOS and Android with real native views, using NativeScript.

Foldkit's runtime (Model, update, Commands, Subscriptions, Effect) runs **unmodified**. Only the bottom layer changes: Foldkit patches a DOM through a vendored snabbdom, and this project gives it a small DOM whose elements are backed by NativeScript views.

```
view(model, h) ─▶ snabbdom patch ─▶ DOM bridge (ElementShim) ─▶ NativeBackend ─▶ UIView / android.view.View
                                        ▲                              │
                Message ◀── update ◀── CustomEvent ◀──────── native event (tap, textChange, …)
```

## Run it

```bash
npm install
npm run ios        # or: npm run android
npm test           # boots Foldkit's real runtime against the bridge in Node
npm run typecheck
```

## Writing an app

The entry file must import the bridge **before** anything from `foldkit`, because Foldkit reads DOM globals while its modules load:

```ts
// src/main.ts
import { createNativeRoot, runApp } from './foldkit-nativescript'; // first!
import { Runtime } from 'foldkit';
import { Model, init, update, view, subscriptions } from './app/main';

const root = createNativeRoot();
const program = Runtime.makeElement({
  Model, init, update, view, subscriptions,
  container: root.container,
  devTools: false,
});

runApp(root, () => Runtime.embed(program));
```

Use `Runtime.makeElement` + `Runtime.embed` (not `makeApplication` + `run`): there is no URL, document title, or browser history on a phone.

### Native elements: `native(h)`

Typed builders for NativeScript views, defined with Foldkit's public `CustomElement.define`. Each one has typed property factories and `On*` event factories:

```ts
const view = (model: Model, h: HtmlBuilder<Message>) => {
  const { StackLayout, Label, Button, TextField, Switch } = native(h);
  return StackLayout([h.Class('page')], [
    Label([Label.Text(`Count: ${model.count}`)]),
    Button([Button.Text('+'), Button.OnTap(() => Message.ClickedIncrement())]),
    TextField([
      TextField.Text(model.draft),
      TextField.Hint('Type…'),
      TextField.OnTextChange(({ value }) => Message.ChangedDraft({ value })),
      TextField.OnReturnPress(() => Message.Submitted()),
    ]),
    Switch([Switch.Checked(model.on), Switch.OnCheckedChange(({ value }) => Message.Toggled({ value }))]),
  ]);
};
```

Available: `StackLayout`, `GridLayout`, `FlexboxLayout`, `WrapLayout`, `DockLayout`, `AbsoluteLayout`, `ContentView`, `ScrollView`, `Label`, `Button`, `TextField`, `TextView`, `SearchBar`, `Switch`, `Slider`, `Progress`, `ActivityIndicator`, `Image`, `ListPicker`, `HtmlView`, `WebView`.
Every element also has `OnTap`, `OnDoubleTap`, `OnLongPress`, `OnSwipe` and `OnLoaded`.

Generic Foldkit attributes work on all of them:

| Foldkit | NativeScript |
| --- | --- |
| `h.Class('a b')` | `className` (styled by `app.css`) |
| `h.Style({ color: 'red' })` | `view.style.color` |
| `h.Attribute('col', '1')` | any view property, set the way NativeScript XML does (`row`, `col`, `colSpan`, `horizontalAlignment`, …) |
| `h.Key(id)` | keyed reconciliation: native children are moved, not rebuilt |
| `h.Id`, `h.Hidden`, `h.Disabled`, `h.Placeholder` | `id`, `visibility: collapse`, `isEnabled`, `hint` |

### Plain HTML builders also work

So existing Foldkit views port with fewer edits, common HTML tags map to native views. Each also gets its tag as a CSS class (`.h1`, `.p`, …):

| HTML | Native view |
| --- | --- |
| `div section main header footer nav article aside form ul ol li` | `StackLayout` |
| `p h1`–`h6` | `Label` (wrapping) |
| `span label strong em small code a` | `Label` |
| `button` / `input` / `textarea` / `img` | `Button` / `TextField` / `TextView` / `Image` |

`h.OnClick` maps to `tap`; `h.OnInput` / `h.Value` map to `textChange` / `text` on text inputs, so controlled inputs work unchanged.

### Custom and plugin views

```ts
import { registerElement } from './foldkit-nativescript';
import { MyChartView } from './my-chart-view';

registerElement('ns-my-chart', () => new MyChartView());
// then type it: CustomElement.define({ tag: 'ns-my-chart', properties: { values: Schema.Array(Schema.Number) }, events: {} })
```

## How it works

| File | Role |
| --- | --- |
| `src/foldkit-nativescript/dom.ts` | DOM-shaped tree (`Node`, `Element`, `Text`, `Comment`, events, `classList`, `style`, selectors). Elements are wrapped in a `Proxy`, so property writes from Foldkit's props module (`elm.text = …`) reach the native view. No NativeScript imports, so it is testable in Node. |
| `backend.ts` | The `NativeBackend` interface between the tree and a view toolkit. |
| `nativescript-backend.ts` | NativeScript implementation: tag registry, child slots (layout / content / text), attribute → property resolution, DOM → native event mapping. |
| `install.ts` | Installs `document`, `window`, `Element`, `CustomEvent`, `matchMedia`, `MessageChannel`, … as globals. NativeScript has no `MessageChannel`, and Foldkit uses it to defer long message drains. |
| `elements.ts` | Typed `CustomElement` specs and the `native(h)` binder. |
| `run.ts` | `createNativeRoot()` / `runApp()`. |

How children are attached depends on the parent view's slot. Layouts insert native children in DOM order, and comments and text are skipped. `ContentView` and `ScrollView` take their first element child as `content`. Text views (`Label`, `Button`, …) concatenate their descendant text into `text`.

## Verified

- `npm test`: Foldkit 0.170's runtime renders through the bridge. Covers taps, keyed insert/move/remove ordering, CustomElement event detail decoding, controlled `h.Value`/`h.OnInput`, and dispose.
- iOS simulator (iOS 27): the demo renders. The counter, the stopwatch (Command + Subscription), typing, return-to-add, switch toggles and keyed delete were each driven through real UIKit control events.
- Android emulator (API 36): the same flows were driven with real `adb` taps and typed text. The root applies edge-to-edge system-bar insets.

## Limitations

- No routing, `document.title`, View Transitions, or server rendering. These are web features of `makeApplication`.
- Foldkit DevTools are DOM overlays; pass `devTools: false`.
- `h.InnerHTML`, SVG, `h.OnKeyDown` and pointer events have no native mapping.
- Views with item templates (`ListView`, `CollectionView`, `SegmentedBar` items, `TabView`) are not wrapped yet. Use keyed children in a `ScrollView` for lists.
