// Must stay the first import: it installs the DOM bridge Foldkit renders into.
import { createNativeRoot, runApp } from './foldkit-nativescript';

import { Runtime } from 'foldkit';

import { Model, init, subscriptions, update, view } from './app/main';

const root = createNativeRoot();

const program = Runtime.makeElement({
  Model,
  init,
  update,
  view,
  subscriptions,
  container: root.container,
  devTools: false,
});

runApp(root, () => Runtime.embed(program));
