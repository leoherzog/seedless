/**
 * Crypto Mock for Testing
 * Provides deterministic random values for reproducible tests
 */

/**
 * Creates a crypto mock with seeded PRNG for deterministic testing
 * Uses a simple Linear Congruential Generator (LCG)
 * @param {number} seed - Initial seed value (default: 42)
 * @returns {Crypto} Mock crypto object
 */
export function createCryptoMock(seed = 42) {
  let state = seed;

  return {
    getRandomValues(array) {
      for (let i = 0; i < array.length; i++) {
        // LCG: same algorithm as glibc
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        array[i] = state % 256;
      }
      return array;
    },

    // Test helper: reset to initial seed
    _reset(newSeed = seed) {
      state = newSeed;
    },

    // Test helper: get current state
    _getState() {
      return state;
    }
  };
}

/**
 * Creates a crypto mock that returns specific bytes
 * Useful for testing exact token values
 * @param {number[]} bytes - Array of byte values to return
 * @returns {Crypto} Mock crypto object
 */
export function createFixedBytesCryptoMock(bytes) {
  let index = 0;

  return {
    getRandomValues(array) {
      for (let i = 0; i < array.length; i++) {
        array[i] = bytes[index % bytes.length];
        index++;
      }
      return array;
    },

    _resetIndex() {
      index = 0;
    }
  };
}

/**
 * Install crypto mock globally
 * @param {Crypto} mock - Mock to install (uses createCryptoMock if not provided)
 * @returns {Crypto} The installed mock
 */
export function installCryptoMock(mock = null) {
  const cryptoMock = mock || createCryptoMock();
  globalThis.crypto = cryptoMock;
  return cryptoMock;
}
