/**
 * Tests for HTML escape utility
 */

import { assertEquals } from 'jsr:@std/assert';
import { escapeHtml } from '../js/utils/html.js';

Deno.test('escapeHtml', async (t) => {
  await t.step('passes through safe text unchanged', () => {
    assertEquals(escapeHtml('hello world'), 'hello world');
    assertEquals(escapeHtml('Hello World 123'), 'Hello World 123');
    assertEquals(escapeHtml('foo-bar_baz'), 'foo-bar_baz');
  });

  await t.step('escapes ampersand', () => {
    assertEquals(escapeHtml('foo & bar'), 'foo &amp; bar');
    assertEquals(escapeHtml('&&'), '&amp;&amp;');
  });

  await t.step('escapes less than', () => {
    assertEquals(escapeHtml('a < b'), 'a &lt; b');
    assertEquals(escapeHtml('<<'), '&lt;&lt;');
  });

  await t.step('escapes greater than', () => {
    assertEquals(escapeHtml('a > b'), 'a &gt; b');
    assertEquals(escapeHtml('>>'), '&gt;&gt;');
  });

  await t.step('escapes double quotes', () => {
    assertEquals(escapeHtml('"quoted"'), '&quot;quoted&quot;');
    assertEquals(escapeHtml('say "hello"'), 'say &quot;hello&quot;');
  });

  await t.step('escapes single quotes', () => {
    assertEquals(escapeHtml("it's"), 'it&#39;s');
    assertEquals(escapeHtml("'test'"), '&#39;test&#39;');
  });

  await t.step('escapes all special characters together', () => {
    assertEquals(
      escapeHtml('&<>"\''),
      '&amp;&lt;&gt;&quot;&#39;'
    );
  });

  await t.step('handles mixed content with HTML tags', () => {
    assertEquals(
      escapeHtml('Hello <script>alert("xss")</script>'),
      'Hello &lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
    assertEquals(
      escapeHtml('<b>bold</b>'),
      '&lt;b&gt;bold&lt;/b&gt;'
    );
  });

  await t.step('coerces numbers to strings', () => {
    assertEquals(escapeHtml(123), '123');
    assertEquals(escapeHtml(0), '0');
    assertEquals(escapeHtml(-456), '-456');
    assertEquals(escapeHtml(3.14), '3.14');
  });

  await t.step('coerces null and undefined', () => {
    assertEquals(escapeHtml(null), 'null');
    assertEquals(escapeHtml(undefined), 'undefined');
  });

  await t.step('handles empty string', () => {
    assertEquals(escapeHtml(''), '');
  });

  await t.step('re-escapes already escaped entities', () => {
    // This is expected behavior - prevents double-encoding attacks
    assertEquals(escapeHtml('&amp;'), '&amp;amp;');
    assertEquals(escapeHtml('&lt;'), '&amp;lt;');
  });

  await t.step('escapes HTML attribute injection attempts', () => {
    assertEquals(
      escapeHtml('href="javascript:alert(1)"'),
      'href=&quot;javascript:alert(1)&quot;'
    );
    assertEquals(
      escapeHtml("onclick='alert(1)'"),
      'onclick=&#39;alert(1)&#39;'
    );
  });

  await t.step('prevents XSS via script injection', () => {
    const xssAttempts = [
      '"><script>alert(1)</script>',
      "' onerror='alert(1)'",
      '<img src=x onerror=alert(1)>',
      '"><img src=x onerror=alert(1)><"',
    ];

    for (const attempt of xssAttempts) {
      const escaped = escapeHtml(attempt);
      // Escaped version should not contain unescaped < or >
      assertEquals(escaped.includes('<'), false, `Should escape < in: ${attempt}`);
      assertEquals(escaped.includes('>'), false, `Should escape > in: ${attempt}`);
    }
  });

  await t.step('handles unicode and special whitespace', () => {
    assertEquals(escapeHtml('Hello 世界'), 'Hello 世界');
    assertEquals(escapeHtml('tab\there'), 'tab\there');
    assertEquals(escapeHtml('new\nline'), 'new\nline');
  });
});
