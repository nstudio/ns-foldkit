import { Application, type View } from '@nativescript/core';

import { document } from './install-nativescript';
import { createMountPoint } from './mount-point';

export interface NativeRoot {
  /** Pass to `Runtime.makeElement({ container })`. */
  readonly container: HTMLElement;
  /** The NativeScript view the app renders into. */
  readonly view: View;
}

export const createNativeRoot = (id = 'app'): NativeRoot => {
  const { host, container } = createMountPoint(document, id);
  return { container: container as unknown as HTMLElement, view: host.nativeView as View };
};

/**
 * Makes `root.view` the app's root view and starts the Foldkit runtime once
 * NativeScript asks for it. `start` is where you call `Runtime.embed`, so
 * Flags, Ports and the returned handle stay fully typed in app code.
 */
export const runApp = (root: NativeRoot, start: () => unknown): void => {
  let isStarted = false;
  Application.run({
    create: () => {
      if (!isStarted) {
        isStarted = true;
        start();
      }
      return root.view;
    },
  });
};
