// Chrome has no `browser` namespace; its `chrome` APIs return promises in MV3.
globalThis.browser = globalThis.browser || globalThis.chrome;
