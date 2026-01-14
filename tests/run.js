/**
 * Simple Test Runner for Seedless
 * Pure ES module test runner with no dependencies
 */

const results = { passed: 0, failed: 0, errors: [] };

/**
 * Run a test case
 * @param {string} name - Test name
 * @param {Function} fn - Test function (can be async)
 */
export async function test(name, fn) {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
    results.passed++;
  } catch (e) {
    console.error(`  \u2717 ${name}`);
    console.error(`    ${e.message}`);
    results.failed++;
    results.errors.push({ name, error: e });
  }
}

/**
 * Assert that two values are equal
 */
export function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg ? msg + ': ' : ''}Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/**
 * Assert that two values are deeply equal
 */
export function assertDeepEqual(actual, expected, msg = '') {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(`${msg ? msg + ': ' : ''}Expected ${expectedStr}, got ${actualStr}`);
  }
}

/**
 * Assert that a value is truthy
 */
export function assertTrue(value, msg = '') {
  if (!value) {
    throw new Error(`${msg ? msg + ': ' : ''}Expected truthy value, got ${JSON.stringify(value)}`);
  }
}

/**
 * Assert that a value is falsy
 */
export function assertFalse(value, msg = '') {
  if (value) {
    throw new Error(`${msg ? msg + ': ' : ''}Expected falsy value, got ${JSON.stringify(value)}`);
  }
}

/**
 * Assert that a function throws
 */
export function assertThrows(fn, expectedMsg = null, msg = '') {
  let threw = false;
  let actualMsg = null;
  try {
    fn();
  } catch (e) {
    threw = true;
    actualMsg = e.message;
  }
  if (!threw) {
    throw new Error(`${msg ? msg + ': ' : ''}Expected function to throw`);
  }
  if (expectedMsg && !actualMsg.includes(expectedMsg)) {
    throw new Error(`${msg ? msg + ': ' : ''}Expected error message to contain "${expectedMsg}", got "${actualMsg}"`);
  }
}

/**
 * Start a test suite
 */
export function describe(name, fn) {
  console.log(`\n${name}`);
  return fn();
}

/**
 * Print test summary and return exit status
 */
export function summary() {
  console.log(`\n${'='.repeat(40)}`);
  console.log(`Tests: ${results.passed} passed, ${results.failed} failed`);
  console.log(`${'='.repeat(40)}\n`);

  if (results.errors.length > 0) {
    console.error('Failures:');
    results.errors.forEach(({ name, error }) => {
      console.error(`  - ${name}: ${error.message}`);
    });
  }

  return results.failed === 0;
}

/**
 * Reset test results (useful when running multiple test files)
 */
export function reset() {
  results.passed = 0;
  results.failed = 0;
  results.errors = [];
}
