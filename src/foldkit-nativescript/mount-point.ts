import type { DocumentShim, ElementShim } from './dom';

export const ROOT_TAG = 'ns-root';
export const CONTAINER_TAG = 'foldkit-container';

export interface MountPoint {
  /** Element whose native view hosts the app; its view is what you hand to NativeScript. */
  readonly host: ElementShim;
  /**
   * DOM-only element passed to Foldkit as `container`. Foldkit swaps it for
   * the rendered root on the first render and restores it on dispose.
   */
  readonly container: ElementShim;
}

/**
 * `id` keys Foldkit's model preservation across hot reloads, so it must be
 * stable for an app and unique among apps mounted at once.
 */
export const createMountPoint = (document: DocumentShim, id = 'app'): MountPoint => {
  const host = document.createElement(ROOT_TAG);
  const container = document.createElement(CONTAINER_TAG);
  container.id = id;
  host.appendChild(container);
  document.body.appendChild(host);
  return { host, container };
};
