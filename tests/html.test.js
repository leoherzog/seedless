/**
 * Tests for HTML escape utility
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../js/utils/html.js';

test('escapeHtml', async (t) => {
  await t.test('passes through safe text unchanged', () => {
    assert.deepStrictEqual(escapeHtml('hello world'), 'hello world');
    assert.deepStrictEqual(escapeHtml('Hello World 123'), 'Hello World 123');
    assert.deepStrictEqual(escapeHtml('foo-bar_baz'), 'foo-bar_baz');
  });

  await t.test('escapes ampersand', () => {
    assert.deepStrictEqual(escapeHtml('foo & bar'), 'foo &amp; bar');
    assert.deepStrictEqual(escapeHtml('&&'), '&amp;&amp;');
  });

  await t.test('escapes less than', () => {
    assert.deepStrictEqual(escapeHtml('a < b'), 'a &lt; b');
    assert.deepStrictEqual(escapeHtml('<<'), '&lt;&lt;');
  });

  await t.test('escapes greater than', () => {
    assert.deepStrictEqual(escapeHtml('a > b'), 'a &gt; b');
    assert.deepStrictEqual(escapeHtml('>>'), '&gt;&gt;');
  });

  await t.test('escapes double quotes', () => {
    assert.deepStrictEqual(escapeHtml('"quoted"'), '&quot;quoted&quot;');
    assert.deepStrictEqual(escapeHtml('say "hello"'), 'say &quot;hello&quot;');
  });

  await t.test('escapes single quotes', () => {
    assert.deepStrictEqual(escapeHtml("it's"), 'it&#39;s');
    assert.deepStrictEqual(escapeHtml("'test'"), '&#39;test&#39;');
  });

  await t.test('escapes all special characters together', () => {
    assert.deepStrictEqual(
      escapeHtml('&<>"\''),
      '&amp;&lt;&gt;&quot;&#39;'
    );
  });

  await t.test('handles mixed content with HTML tags', () => {
    assert.deepStrictEqual(
      escapeHtml('Hello <script>alert("xss")</script>'),
      'Hello &lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
    assert.deepStrictEqual(
      escapeHtml('<b>bold</b>'),
      '&lt;b&gt;bold&lt;/b&gt;'
    );
  });

  await t.test('coerces numbers to strings', () => {
    assert.deepStrictEqual(escapeHtml(123), '123');
    assert.deepStrictEqual(escapeHtml(0), '0');
    assert.deepStrictEqual(escapeHtml(-456), '-456');
    assert.deepStrictEqual(escapeHtml(3.14), '3.14');
  });

  await t.test('coerces null and undefined', () => {
    assert.deepStrictEqual(escapeHtml(null), 'null');
    assert.deepStrictEqual(escapeHtml(undefined), 'undefined');
  });

  await t.test('handles empty string', () => {
    assert.deepStrictEqual(escapeHtml(''), '');
  });

  await t.test('re-escapes already escaped entities', () => {
    // Escaping is not idempotent, so escape exactly once, at render time.
    assert.deepStrictEqual(escapeHtml('&amp;'), '&amp;amp;');
    assert.deepStrictEqual(escapeHtml('&lt;'), '&amp;lt;');
  });

  await t.test('escapes HTML attribute injection attempts', () => {
    assert.deepStrictEqual(
      escapeHtml('href="javascript:alert(1)"'),
      'href=&quot;javascript:alert(1)&quot;'
    );
    assert.deepStrictEqual(
      escapeHtml("onclick='alert(1)'"),
      'onclick=&#39;alert(1)&#39;'
    );
  });

  await t.test('prevents XSS via script injection', () => {
    const xssAttempts = [
      '"><script>alert(1)</script>',
      "' onerror='alert(1)'",
      '<img src=x onerror=alert(1)>',
      '"><img src=x onerror=alert(1)><"',
    ];

    for (const attempt of xssAttempts) {
      const escaped = escapeHtml(attempt);
      assert.deepStrictEqual(escaped.includes('<'), false, `Should escape < in: ${attempt}`);
      assert.deepStrictEqual(escaped.includes('>'), false, `Should escape > in: ${attempt}`);
    }
  });

  await t.test('handles unicode and special whitespace', () => {
    assert.deepStrictEqual(escapeHtml('Hello 世界'), 'Hello 世界');
    assert.deepStrictEqual(escapeHtml('tab\there'), 'tab\there');
    assert.deepStrictEqual(escapeHtml('new\nline'), 'new\nline');
  });
});
