import { installDom } from './install';
import { nativeScriptBackend } from './nativescript-backend';

export const document = installDom(nativeScriptBackend);
