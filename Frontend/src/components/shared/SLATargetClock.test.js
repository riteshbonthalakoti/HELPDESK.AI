import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./SLATargetClock.jsx', import.meta.url), 'utf8');

test('SLATargetClock exports default React component', () => {
  assert.ok(source.includes('export default function SLATargetClock'));
});

test('SLATargetClock implements 1000ms ticking interval', () => {
  assert.match(source, /setInterval\([\s\S]*?1000\)/);
  assert.match(source, /clearInterval\(timer\)/);
});

test('SLATargetClock supports dial, compact, and badge variants', () => {
  assert.ok(source.includes("variant === 'compact'"));
  assert.ok(source.includes("variant === 'badge'"));
  assert.ok(source.includes("variant === 'dial'"));
});

test('SLATargetClock computes SVG circular arc and ticks', () => {
  assert.ok(source.includes('circumference'));
  assert.ok(source.includes('strokeDashoffset'));
  assert.ok(source.includes('strokeDasharray'));
  assert.ok(source.includes('quadrantTicks'));
});
