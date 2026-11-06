import { Schema } from 'effect';
import { CustomElement } from 'foldkit';
import type { HtmlBuilder } from 'foldkit/html';

const NoDetail = Schema.Struct({});
const StringValue = Schema.Struct({ value: Schema.String });
const NumberValue = Schema.Struct({ value: Schema.Number });
const BooleanValue = Schema.Struct({ value: Schema.Boolean });

/** Gestures every NativeScript view emits. */
const gestureEvents = {
  tap: NoDetail,
  'double-tap': NoDetail,
  'long-press': NoDetail,
  swipe: Schema.Struct({ direction: Schema.Number }),
  loaded: NoDetail,
};

const Orientation = Schema.Literals(['vertical', 'horizontal']);

const define = <
  const Tag extends `ns-${string}`,
  const Properties extends Record<string, Schema.Top>,
  const Events extends Record<string, CustomElement.EventSchema>,
>(
  tag: Tag,
  properties: Properties,
  events: Events,
) => CustomElement.define({ tag, properties, events: { ...gestureEvents, ...events } });

export const StackLayout = define('ns-stack-layout', { orientation: Orientation }, {});
export const GridLayout = define('ns-grid-layout', { rows: Schema.String, columns: Schema.String }, {});
export const FlexboxLayout = define(
  'ns-flexbox-layout',
  {
    flexDirection: Schema.Literals(['row', 'row-reverse', 'column', 'column-reverse']),
    flexWrap: Schema.Literals(['nowrap', 'wrap', 'wrap-reverse']),
    justifyContent: Schema.Literals(['flex-start', 'flex-end', 'center', 'space-between', 'space-around']),
    alignItems: Schema.Literals(['flex-start', 'flex-end', 'center', 'baseline', 'stretch']),
  },
  {},
);
export const WrapLayout = define(
  'ns-wrap-layout',
  { orientation: Orientation, itemWidth: Schema.Number, itemHeight: Schema.Number },
  {},
);
export const DockLayout = define('ns-dock-layout', { stretchLastChild: Schema.Boolean }, {});
export const AbsoluteLayout = define('ns-absolute-layout', {}, {});
export const ContentView = define('ns-content-view', {}, {});
export const ScrollView = define(
  'ns-scroll-view',
  { orientation: Orientation },
  { scroll: Schema.Struct({ scrollX: Schema.Number, scrollY: Schema.Number }) },
);

export const Label = define('ns-label', { text: Schema.String, textWrap: Schema.Boolean }, {});
export const Button = define('ns-button', { text: Schema.String, textWrap: Schema.Boolean }, {});
export const TextField = define(
  'ns-text-field',
  {
    text: Schema.String,
    hint: Schema.String,
    secure: Schema.Boolean,
    editable: Schema.Boolean,
    maxLength: Schema.Number,
    keyboardType: Schema.Literals(['datetime', 'phone', 'number', 'url', 'email', 'integer']),
    returnKeyType: Schema.Literals(['done', 'next', 'go', 'search', 'send']),
  },
  { 'text-change': StringValue, 'return-press': StringValue, focus: NoDetail, blur: NoDetail },
);
export const TextView = define(
  'ns-text-view',
  { text: Schema.String, hint: Schema.String, editable: Schema.Boolean, maxLength: Schema.Number },
  { 'text-change': StringValue, focus: NoDetail, blur: NoDetail },
);
export const SearchBar = define(
  'ns-search-bar',
  { text: Schema.String, hint: Schema.String },
  { 'text-change': StringValue, submit: StringValue, clear: NoDetail },
);
export const Switch = define('ns-switch', { checked: Schema.Boolean }, { 'checked-change': BooleanValue });
export const Slider = define(
  'ns-slider',
  { value: Schema.Number, minValue: Schema.Number, maxValue: Schema.Number },
  { 'value-change': NumberValue },
);
export const Progress = define('ns-progress', { value: Schema.Number, maxValue: Schema.Number }, {});
export const ActivityIndicator = define('ns-activity-indicator', { busy: Schema.Boolean }, {});
export const Image = define(
  'ns-image',
  { src: Schema.String, stretch: Schema.Literals(['none', 'aspectFill', 'aspectFit', 'fill']) },
  {},
);
export const ListPicker = define(
  'ns-list-picker',
  { items: Schema.Array(Schema.String), selectedIndex: Schema.Number },
  { 'selected-index-change': NumberValue },
);
export const HtmlView = define('ns-html-view', { html: Schema.String }, {});
export const WebView = define('ns-web-view', { src: Schema.String }, {});

const specs = {
  StackLayout,
  GridLayout,
  FlexboxLayout,
  WrapLayout,
  DockLayout,
  AbsoluteLayout,
  ContentView,
  ScrollView,
  Label,
  Button,
  TextField,
  TextView,
  SearchBar,
  Switch,
  Slider,
  Progress,
  ActivityIndicator,
  Image,
  ListPicker,
  HtmlView,
  WebView,
};

export type NativeElements<Message> = {
  readonly [Name in keyof typeof specs]: CustomElement.Builder<(typeof specs)[Name], Message>;
};

/**
 * Binds every NativeScript element to a view's Message type:
 *
 * ```ts
 * const view = (model: Model, h: HtmlBuilder<Message>) => {
 *   const { StackLayout, Label, Button } = native(h)
 *   return StackLayout([], [
 *     Label([Label.Text(`${model.count}`)]),
 *     Button([Button.Text('+'), Button.OnTap(() => Message.ClickedIncrement())]),
 *   ])
 * }
 * ```
 */
export const native = <Message>(h: HtmlBuilder<Message>): NativeElements<Message> =>
  Object.fromEntries(Object.entries(specs).map(([name, spec]) => [name, spec.withMessage(h)])) as NativeElements<Message>;
