import { Clock, Duration, Effect, Schema, Stream } from 'effect';
import { Command, Runtime, Subscription, type Update } from 'foldkit';
import type { Html, HtmlBuilder } from 'foldkit/html';
import { defineMessageUnion } from 'foldkit/message';
import { modifyFields } from 'foldkit/struct';

import { native } from '../foldkit-nativescript';

// MODEL

const Todo = Schema.Struct({ id: Schema.Number, title: Schema.String, done: Schema.Boolean });
type Todo = typeof Todo.Type;

export const Model = Schema.Struct({
  count: Schema.Number,
  elapsedMs: Schema.Number,
  isRunning: Schema.Boolean,
  startTime: Schema.Number,
  draft: Schema.String,
  nextTodoId: Schema.Number,
  todos: Schema.Array(Todo),
});
export type Model = typeof Model.Type;

// MESSAGE

export const Message = defineMessageUnion({
  ClickedDecrement: {},
  ClickedIncrement: {},
  ClickedResetCount: {},
  ClickedStart: {},
  ClickedStop: {},
  ClickedResetStopwatch: {},
  CompletedDetermineStartTime: { startTime: Schema.Number },
  Ticked: {},
  CompletedDetermineTickTime: { elapsedMs: Schema.Number },
  ChangedDraft: { value: Schema.String },
  SubmittedDraft: {},
  ToggledTodo: { id: Schema.Number, done: Schema.Boolean },
  ClickedDeleteTodo: { id: Schema.Number },
});
export type Message = typeof Message.Type;

// COMMAND

const DetermineStartTime = Command.define('DetermineStartTime', {
  args: { elapsedMs: Schema.Number },
  messages: [Message.CompletedDetermineStartTime],
  execute: ({ elapsedMs }) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      return Message.CompletedDetermineStartTime({ startTime: now - elapsedMs });
    }),
});

const DetermineTickTime = Command.define('DetermineTickTime', {
  args: { startTime: Schema.Number },
  messages: [Message.CompletedDetermineTickTime],
  execute: ({ startTime }) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      return Message.CompletedDetermineTickTime({ elapsedMs: now - startTime });
    }),
});

// UPDATE

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedDecrement: () => ({ model: modifyFields(model, { count: count => count - 1 }) }),
    ClickedIncrement: () => ({ model: modifyFields(model, { count: count => count + 1 }) }),
    ClickedResetCount: () => ({ model: modifyFields(model, { count: () => 0 }) }),

    ClickedStart: () => ({ model, commands: [DetermineStartTime({ elapsedMs: model.elapsedMs })] }),
    CompletedDetermineStartTime: ({ startTime }) => ({
      model: modifyFields(model, { isRunning: () => true, startTime: () => startTime }),
    }),
    ClickedStop: () => ({ model: modifyFields(model, { isRunning: () => false }) }),
    ClickedResetStopwatch: () => ({
      model: modifyFields(model, { elapsedMs: () => 0, isRunning: () => false, startTime: () => 0 }),
    }),
    Ticked: () => ({ model, commands: [DetermineTickTime({ startTime: model.startTime })] }),
    CompletedDetermineTickTime: ({ elapsedMs }) => ({
      model: model.isRunning ? modifyFields(model, { elapsedMs: () => elapsedMs }) : model,
    }),

    ChangedDraft: ({ value }) => ({ model: modifyFields(model, { draft: () => value }) }),
    SubmittedDraft: () => {
      const title = model.draft.trim();
      return title === ''
        ? { model }
        : {
            model: modifyFields(model, {
              draft: () => '',
              nextTodoId: id => id + 1,
              todos: todos => [...todos, { id: model.nextTodoId, title, done: false }],
            }),
          };
    },
    ToggledTodo: ({ id, done }) => ({
      model: modifyFields(model, {
        todos: todos => todos.map(todo => (todo.id === id ? { ...todo, done } : todo)),
      }),
    }),
    ClickedDeleteTodo: ({ id }) => ({
      model: modifyFields(model, { todos: todos => todos.filter(todo => todo.id !== id) }),
    }),
  });

// INIT

export const init: Runtime.ElementInit<Model, Message> = () => ({
  model: {
    count: 0,
    elapsedMs: 0,
    isRunning: false,
    startTime: 0,
    draft: '',
    nextTodoId: 3,
    todos: [
      { id: 1, title: 'Render Foldkit with native views', done: true },
      { id: 2, title: 'Ship it', done: false },
    ],
  },
});

// SUBSCRIPTION

export const subscriptions = Subscription.make<Model, Message>()(entry => ({
  tick: entry(
    { isRunning: Schema.Boolean },
    {
      modelToDependencies: model => ({ isRunning: model.isRunning }),
      dependenciesToStream: ({ isRunning }) =>
        Stream.when(
          Stream.tick(Duration.millis(30)).pipe(Stream.drop(1), Stream.map(Message.Ticked)),
          Effect.sync(() => isRunning),
        ),
    },
  ),
}));

// VIEW

const pad = (value: number) => Math.floor(value).toString().padStart(2, '0');

const formatTime = (ms: number) => `${pad(ms / 60000)}:${pad((ms % 60000) / 1000)}.${pad((ms % 1000) / 10)}`;

/** Plain Foldkit HTML builders, rendered through the bridge's HTML aliases. */
const counterCard = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('card')],
    [
      h.h2([], ['Counter (h.div / h.button)']),
      h.p([h.Class('count')], [model.count.toString()]),
      h.div(
        [h.Class('row')],
        [
          h.button([h.Class('btn'), h.OnClick(Message.ClickedDecrement())], ['−']),
          h.button([h.Class('btn btn-muted'), h.OnClick(Message.ClickedResetCount())], ['Reset']),
          h.button([h.Class('btn'), h.OnClick(Message.ClickedIncrement())], ['+']),
        ],
      ),
    ],
  );

const stopwatchCard = (model: Model, h: HtmlBuilder<Message>): Html => {
  const { StackLayout, GridLayout, Label, Button } = native(h);
  return StackLayout(
    [h.Class('card')],
    [
      Label([h.Class('h2'), Label.Text('Stopwatch (Command + Subscription)')]),
      Label([h.Class('time'), Label.Text(formatTime(model.elapsedMs))]),
      GridLayout(
        [GridLayout.Columns('*, *'), h.Class('row')],
        [
          Button([
            h.Class('btn btn-muted'),
            h.Attribute('col', '0'),
            Button.Text('Reset'),
            Button.OnTap(() => Message.ClickedResetStopwatch()),
          ]),
          Button([
            h.Class(model.isRunning ? 'btn btn-stop' : 'btn btn-go'),
            h.Attribute('col', '1'),
            Button.Text(model.isRunning ? 'Stop' : 'Start'),
            Button.OnTap(() => (model.isRunning ? Message.ClickedStop() : Message.ClickedStart())),
          ]),
        ],
      ),
    ],
  );
};

const todoRow = (todo: Todo, h: HtmlBuilder<Message>): Html => {
  const { GridLayout, Label, Switch } = native(h);
  return GridLayout(
    [h.Key(String(todo.id)), GridLayout.Columns('auto, *, auto'), h.Class('todo')],
    [
      Switch([
        h.Attribute('col', '0'),
        Switch.Checked(todo.done),
        Switch.OnCheckedChange(({ value }) => Message.ToggledTodo({ id: todo.id, done: value })),
      ]),
      Label([
        h.Attribute('col', '1'),
        h.Class(todo.done ? 'todo-title done' : 'todo-title'),
        Label.Text(todo.title),
        Label.TextWrap(true),
      ]),
      Label([
        h.Attribute('col', '2'),
        h.Class('delete'),
        Label.Text('✕'),
        Label.OnTap(() => Message.ClickedDeleteTodo({ id: todo.id })),
      ]),
    ],
  );
};

const todoCard = (model: Model, h: HtmlBuilder<Message>): Html => {
  const { StackLayout, Label, TextField } = native(h);
  const remaining = model.todos.filter(todo => !todo.done).length;
  return StackLayout(
    [h.Class('card')],
    [
      Label([h.Class('h2'), Label.Text(`Todos (${remaining} left)`)]),
      TextField([
        h.Class('input'),
        TextField.Hint('What needs doing?'),
        TextField.Text(model.draft),
        TextField.ReturnKeyType('done'),
        TextField.OnTextChange(({ value }) => Message.ChangedDraft({ value })),
        TextField.OnReturnPress(() => Message.SubmittedDraft()),
      ]),
      StackLayout(
        [],
        model.todos.map(todo => todoRow(todo, h)),
      ),
    ],
  );
};

export const view = (model: Model, h: HtmlBuilder<Message>): Html => {
  const { ScrollView, StackLayout, Label } = native(h);
  return ScrollView(
    [],
    [
      StackLayout(
        [h.Class('page')],
        [
          Label([h.Class('title'), Label.Text('Foldkit × NativeScript')]),
          Label([
            h.Class('subtitle'),
            Label.TextWrap(true),
            Label.Text('Elm architecture on Effect, rendered with native iOS and Android views.'),
          ]),
          counterCard(model, h),
          stopwatchCard(model, h),
          todoCard(model, h),
        ],
      ),
    ],
  );
};
