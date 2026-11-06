import { beforeAll, describe, expect, it } from 'vitest';

import type { DocumentShim } from '../src/foldkit-nativescript/dom';
import { installDom } from '../src/foldkit-nativescript/install';
import { createMountPoint } from '../src/foldkit-nativescript/mount-point';
import { FakeView, recordingBackend } from './recording-backend';

let document: DocumentShim;

// Foldkit reads DOM globals while its modules evaluate, so it is imported only
// after the bridge is installed.
let foldkit: typeof import('foldkit');
let messages: typeof import('foldkit/message');
let effect: typeof import('effect');

beforeAll(async () => {
  // NativeScript has no MessageChannel; run against the bridge's shim instead of Node's.
  delete (globalThis as { MessageChannel?: unknown }).MessageChannel;
  document = installDom(recordingBackend);
  foldkit = await import('foldkit');
  messages = await import('foldkit/message');
  effect = await import('effect');
});

const nextFrame = () => new Promise(resolve => setTimeout(resolve, 40));

const hostView = (host: { nativeView: unknown }) => host.nativeView as FakeView;

describe('Foldkit runtime on the DOM bridge', () => {
  it('renders, handles a tap, and re-renders a counter', async () => {
    const { Schema } = effect;
    const Model = Schema.Struct({ count: Schema.Number });
    const Message = messages.defineMessageUnion({ ClickedIncrement: {} });
    type Model = typeof Model.Type;

    const { host, container } = createMountPoint(document, 'app-1');
    const program = foldkit.Runtime.makeElement({
      Model,
      init: () => ({ model: { count: 0 } }),
      update: (model: Model) => ({ model: { count: model.count + 1 } }),
      view: (model, h) =>
        h.div(
          [h.Class('page')],
          [h.p([], [`Count: ${model.count}`]), h.button([h.OnClick(Message.ClickedIncrement())], ['+'])],
        ),
      container: container as never,
      devTools: false,
    });
    const handle = foldkit.Runtime.embed(program);
    await nextFrame();

    const root = hostView(host).content!;
    expect(root.tag).toBe('div');
    expect(root.className).toBe('page');
    expect(root.children.map(view => view.tag)).toEqual(['p', 'button']);
    expect(root.children[0]!.text).toBe('Count: 0');

    root.children[1]!.fire('click');
    await nextFrame();
    expect(root.children[0]!.text).toBe('Count: 1');

    handle.dispose();
    await nextFrame();
    expect(hostView(host).content).toBeUndefined();
  });

  it('keeps native child order through keyed inserts, moves, and removals', async () => {
    const { Schema } = effect;
    const Model = Schema.Struct({ items: Schema.Array(Schema.String) });
    const Message = messages.defineMessageUnion({ Shuffled: {} });
    type Model = typeof Model.Type;
    const sequences: string[][] = [
      ['a', 'b', 'c'],
      ['c', 'a', 'd', 'b'],
      ['d', 'b'],
      ['e', 'd', 'b', 'a'],
    ];
    let step = 0;

    const { host, container } = createMountPoint(document, 'app-2');
    const program = foldkit.Runtime.makeElement({
      Model,
      init: () => ({ model: { items: sequences[0]! } }),
      update: () => ({ model: { items: sequences[++step]! } }),
      view: (model, h) =>
        h.div(
          [h.OnClick(Message.Shuffled())],
          model.items.map(item => h.keyed('span')(item, [], [item])),
        ),
      container: container as never,
      devTools: false,
    });
    const handle = foldkit.Runtime.embed(program);
    await nextFrame();
    const root = hostView(host).content!;

    for (const expected of sequences) {
      expect(root.children.map(view => view.text)).toEqual(expected);
      root.fire('click');
      await nextFrame();
    }
    handle.dispose();
  });

  it('delivers CustomElement events with decoded detail and writes typed properties', async () => {
    const { Schema } = effect;
    const Model = Schema.Struct({ text: Schema.String });
    const Message = messages.defineMessageUnion({ ChangedText: { value: Schema.String } });
    type Model = typeof Model.Type;
    type Message = typeof Message.Type;

    const TextField = foldkit.CustomElement.define({
      tag: 'ns-text-field',
      properties: { text: Schema.String },
      events: { 'text-change': Schema.Struct({ value: Schema.String }) },
    });

    const { host, container } = createMountPoint(document, 'app-3');
    const program = foldkit.Runtime.makeElement({
      Model,
      init: () => ({ model: { text: 'hello' } }),
      update: (_model: Model, message: Message) => ({ model: { text: message.value } }),
      view: (model, h) => {
        const field = TextField.withMessage(h);
        return h.div(
          [],
          [field([field.Text(model.text), field.OnTextChange(({ value }) => Message.ChangedText({ value }))]), h.span([], [model.text])],
        );
      },
      container: container as never,
      devTools: false,
    });
    const handle = foldkit.Runtime.embed(program);
    await nextFrame();
    const root = hostView(host).content!;
    const [field, echo] = root.children;
    expect(field!.props.text).toBe('hello');

    field!.fire('text-change', { value: 'world' });
    await nextFrame();
    expect(echo!.text).toBe('world');
    expect(field!.props.text).toBe('world');
    handle.dispose();
  });

  it('maps h.Value and h.OnInput onto the native value', async () => {
    const { Schema } = effect;
    const Model = Schema.Struct({ draft: Schema.String });
    const Message = messages.defineMessageUnion({ Typed: { value: Schema.String } });
    type Model = typeof Model.Type;
    type Message = typeof Message.Type;

    const { host, container } = createMountPoint(document, 'app-4');
    const program = foldkit.Runtime.makeElement({
      Model,
      init: () => ({ model: { draft: '' } }),
      update: (_model: Model, message: Message) => ({ model: { draft: message.value.toUpperCase() } }),
      view: (model, h) =>
        h.div([], [h.input([h.Value(model.draft), h.OnInput(value => Message.Typed({ value }))])]),
      container: container as never,
      devTools: false,
    });
    const handle = foldkit.Runtime.embed(program);
    await nextFrame();
    const input = hostView(host).content!.children[0]!;

    input.text = 'abc';
    input.fire('input');
    await nextFrame();
    expect(input.text).toBe('ABC');
    handle.dispose();
  });
  it('processes a burst of messages that exceeds the drain budget', async () => {
    const { Schema } = effect;
    const Model = Schema.Struct({ count: Schema.Number });
    const Message = messages.defineMessageUnion({ Typed: {} });
    type Model = typeof Model.Type;
    const BURST = 12;

    const { host, container } = createMountPoint(document, 'app-burst');
    const program = foldkit.Runtime.makeElement({
      Model,
      init: () => ({ model: { count: 0 } }),
      update: (model: Model) => {
        const busyUntil = performance.now() + 2;
        while (performance.now() < busyUntil) {}
        return { model: { count: model.count + 1 } };
      },
      view: (model, h) => h.div([h.OnClick(Message.Typed())], [h.span([], [String(model.count)])]),
      container: container as never,
      devTools: false,
    });
    const handle = foldkit.Runtime.embed(program);
    await nextFrame();
    const root = hostView(host).content!;

    for (let index = 0; index < BURST; index++) {
      root.fire('click');
    }
    await nextFrame();
    await nextFrame();
    expect(root.children[0]!.text).toBe(String(BURST));
    handle.dispose();
  });
});
