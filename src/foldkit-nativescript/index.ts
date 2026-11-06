// Must stay the first import: Foldkit reads DOM globals while its modules load.
import './install-nativescript';

export { createNativeRoot, runApp, type NativeRoot } from './run';
export { registerElement, type ViewFactory } from './nativescript-backend';
export * from './elements';
