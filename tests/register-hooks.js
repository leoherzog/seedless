/**
 * Module hooks the test scripts load with --import. Resolves room.js's Trystero
 * CDN import to tests/mocks/trystero-mock.js, so tests never reach the network.
 */

import { registerHooks } from 'node:module';

const TRYSTERO_URL = 'https://cdn.jsdelivr.net/npm/@trystero-p2p/nostr@0.26/+esm';
const MOCK_URL = new URL('./mocks/trystero-mock.js', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === TRYSTERO_URL) return { url: MOCK_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
