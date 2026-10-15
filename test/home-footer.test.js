const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/home.css'), 'utf8');

test('footer retains the original detailed mascot on a responsive cream panel', () => {
  const footer = html.match(/<footer class="home-footer">[\s\S]*?<\/footer>/)[0];
  assert.match(footer, /src="\/assets\/home\/wordmark-phone\.png"/);
  assert.match(footer, /href="\/" aria-label="Hometown Crawls home"/);
  const rules = [...css.matchAll(/\.home-footer \.home-wordmark(?: img)?\s*\{([^}]+)\}/g)].map(match => match[1]);
  assert.ok(rules.some(rule => /background: var\(--home-cream\)/.test(rule)));
  assert.ok(rules.some(rule => /max-width: 100%/.test(rule)));
  for (const rule of rules) assert.doesNotMatch(rule, /filter\s*:/);
});

test('organizer CTA uses the standard high-contrast filled button and preserves its route', () => {
  const button = html.match(/<a class="([^"]+)" href="\/organize\.html">Apply to organize/);
  assert.ok(button);
  assert.equal(button[1], 'home-button');
  assert.match(css, /\.home-button\s*\{[^}]*color: var\(--home-paper\)/);
  const color = name => css.match(new RegExp(`--home-${name}: (#[a-f0-9]{6})`))[1];
  const luminance = hex => hex.slice(1).match(/../g).map(part => parseInt(part, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  for (const background of ['orange', 'orange-hover']) {
    const ratio = (luminance(color('paper')) + 0.05) / (luminance(color(background)) + 0.05);
    assert.ok(ratio >= 4.5, `${background} contrast ${ratio.toFixed(2)} must meet WCAG AA`);
  }
});
