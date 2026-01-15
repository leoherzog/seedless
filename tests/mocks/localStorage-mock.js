/**
 * localStorage Mock for Testing
 * Provides a complete localStorage API for Deno tests
 */

/**
 * Creates a fresh localStorage mock instance
 * @returns {Storage} Mock localStorage object
 */
export function createLocalStorageMock() {
  const data = {};

  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },

    setItem(key, value) {
      data[key] = String(value);
    },

    removeItem(key) {
      delete data[key];
    },

    clear() {
      for (const key in data) {
        delete data[key];
      }
    },

    key(index) {
      const keys = Object.keys(data);
      return keys[index] !== undefined ? keys[index] : null;
    },

    get length() {
      return Object.keys(data).length;
    },

    // Test helper: get raw data object
    _getData() {
      return { ...data };
    },

    // Test helper: set raw data directly
    _setData(newData) {
      this.clear();
      for (const key in newData) {
        data[key] = newData[key];
      }
    }
  };
}

/**
 * Creates a localStorage mock that throws on setItem (simulates quota exceeded)
 * @param {number} failCount - Number of times to fail before succeeding (default: Infinity)
 * @returns {Storage} Mock localStorage that throws on setItem
 */
export function createQuotaExceededMock(failCount = Infinity) {
  const storage = createLocalStorageMock();
  let failures = 0;
  const originalSetItem = storage.setItem;

  storage.setItem = function(key, value) {
    if (failures < failCount) {
      failures++;
      const error = new Error('QuotaExceededError');
      error.name = 'QuotaExceededError';
      throw error;
    }
    return originalSetItem.call(this, key, value);
  };

  storage._getFailureCount = () => failures;

  return storage;
}

/**
 * Install localStorage mock globally
 * @param {Storage} mock - Mock to install (uses createLocalStorageMock if not provided)
 * @returns {Storage} The installed mock
 */
export function installLocalStorageMock(mock = null) {
  const storage = mock || createLocalStorageMock();
  globalThis.localStorage = storage;
  return storage;
}
