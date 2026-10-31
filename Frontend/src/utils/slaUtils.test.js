import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SLA_PRIORITY_HOURS,
  getSlaTargetMs,
  calculateSlaCountdown,
  formatTickingOffset,
  getSlaStatusTheme,
} from './slaUtils.js';

test('getSlaTargetMs returns expected bounds per priority', () => {
  assert.equal(getSlaTargetMs('critical'), 1 * 3600 * 1000);
  assert.equal(getSlaTargetMs('high'), 4 * 3600 * 1000);
  assert.equal(getSlaTargetMs('medium'), 24 * 3600 * 1000);
  assert.equal(getSlaTargetMs('low'), 48 * 3600 * 1000);
  assert.equal(getSlaTargetMs('unknown_priority'), 48 * 3600 * 1000);
  // Custom hour override
  assert.equal(getSlaTargetMs('low', 12), 12 * 3600 * 1000);
});

test('calculateSlaCountdown detects on_track, warning, critical, and breached', () => {
  const baseNow = 1700000000000;
  const targetMs = 4 * 3600 * 1000; // high = 4h

  // On track (> 50% left)
  const createdOnTrack = new Date(baseNow - 1 * 3600 * 1000).toISOString();
  const resOnTrack = calculateSlaCountdown(createdOnTrack, 'high', { now: baseNow });
  assert.equal(resOnTrack.status, 'on_track');
  assert.equal(resOnTrack.isBreached, false);
  assert.equal(resOnTrack.progressPct, 75);

  // Warning (<= 50% left)
  const createdWarning = new Date(baseNow - 2.5 * 3600 * 1000).toISOString();
  const resWarning = calculateSlaCountdown(createdWarning, 'high', { now: baseNow });
  assert.equal(resWarning.status, 'warning');

  // Critical (<= 25% left)
  const createdCritical = new Date(baseNow - 3.5 * 3600 * 1000).toISOString();
  const resCritical = calculateSlaCountdown(createdCritical, 'high', { now: baseNow });
  assert.equal(resCritical.status, 'critical');

  // Breached (<= 0 left)
  const createdBreached = new Date(baseNow - 4.5 * 3600 * 1000).toISOString();
  const resBreached = calculateSlaCountdown(createdBreached, 'high', { now: baseNow });
  assert.equal(resBreached.status, 'breached');
  assert.equal(resBreached.isBreached, true);
  assert.equal(resBreached.progressPct, 0);
});

test('calculateSlaCountdown handles resolved state', () => {
  const baseNow = 1700000000000;
  const created = new Date(baseNow - 2 * 3600 * 1000).toISOString();
  const resResolved = calculateSlaCountdown(created, 'high', {
    now: baseNow,
    ticketStatus: 'resolved',
  });
  assert.equal(resResolved.isResolved, true);
  assert.equal(resResolved.status, 'resolved');
  assert.equal(resResolved.slaMet, true);
});

test('formatTickingOffset handles positive, negative, and compact formats', () => {
  assert.equal(formatTickingOffset(3661000), '01:01:01');
  assert.equal(formatTickingOffset(45000), '00:00:45');
  assert.equal(formatTickingOffset(7200000, { compact: true }), '2h 0m');
  assert.equal(formatTickingOffset(-125000, { showSign: true }), '-00:02:05');
});

test('getSlaStatusTheme provides styled tokens for each state', () => {
  const breachedTheme = getSlaStatusTheme('breached');
  assert.equal(breachedTheme.pulse, true);
  assert.equal(breachedTheme.text, '#B91C1C');

  const onTrackTheme = getSlaStatusTheme('on_track');
  assert.equal(onTrackTheme.pulse, false);
  assert.equal(onTrackTheme.text, '#15803D');
});
