const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Store, Budget, PlaybackClock, dayKey, nextMidnight, dailySeries, renewalText } = require('../youtube-limit.user.js');
process.env.TZ = 'America/New_York';
const video = { id: 'abcdefghijk', title: 'A useful video', channel: 'A channel' };
function fixture(time = '2026-10-22T12:00:00') {
  let now = new Date(time).getTime();
  const data = new Map();
  const api = {
    async listValues() { return [...data.keys()]; },
    async getValue(k) { return structuredClone(data.get(k)); },
    async setValue(k, v) { data.set(k, structuredClone(v)); }
  };
  let id = 0;
  const create = () => new Budget(new Store(api), `tab-${++id}`, () => now);
  return { create, data, now: () => now, advance: ms => { now += ms; } };
}

test('onboarding persists the initial limit and validates custom values', async () => {
  const f = fixture(), b = f.create();
  assert.equal(b.summary().limit, 0);
  await assert.rejects(b.configure(4)); await assert.rejects(b.configure(241)); await assert.rejects(b.configure(5.5));
  await b.configure(60);
  assert.equal(b.summary().remaining, 3600000);
  const reopened = f.create(); await reopened.sync(); assert.equal(reopened.summary().limit, 3600000);
});
test('wall clock counts playback, not media speed or seeking', () => {
  for (const rate of [0.5, 1, 2]) {
    const c = new PlaybackClock();
    assert.equal(c.sample(0, 0, true), 0);
    assert.equal(c.sample(1000, rate, true), 1000);
    c.reset(); assert.equal(c.sample(2000, 500, false), 0);
    assert.equal(c.sample(3000, 500, false), 0);
    c.reset(); assert.equal(c.sample(4000, 800, true), 0);
    assert.equal(c.sample(5000, 800 + rate, true), 1000);
  }
});
test('buffering, stalls, suspension, and background playback are conservative', () => {
  const c = new PlaybackClock(); c.sample(0, 0, true);
  assert.equal(c.sample(1000, 0, true), 0);
  assert.equal(c.sample(2000, 1, false), 0);
  c.reset(); c.sample(3000, 1, true);
  assert.equal(c.sample(4000, 2, true), 1000); // no visibility dependency
  assert.equal(c.sample(90000, 88, true), 0);
  assert.equal(c.sample(91000, 89, true), 1000);
});
test('rewatches aggregate by video ID, refresh and browser restart preserve usage', async () => {
  const f = fixture(), b = f.create(); await b.configure(60);
  await b.add(1000, video); await b.add(2000, video);
  await b.add(500, { ...video, id: 'zyxwvutsrqp' });
  for (let i = 0; i < 2; i++) {
    const reopened = f.create(); await reopened.sync();
    assert.equal(reopened.summary().used, 3500);
    assert.equal(reopened.summary().videos.find(v => v.id === video.id).ms, 3000);
  }
});
test('changes before playback apply today; starts lock even before a whole second is watched', async () => {
  const f = fixture(), b = f.create(); await b.configure(60); f.advance(1); await b.configure(30);
  assert.equal(b.summary().limit, 1800000);
  f.advance(1); await b.start(); f.advance(1); await b.configure(120);
  assert.equal(b.summary().limit, 1800000);
  assert.equal(b.limit('2026-10-23'), 7200000);
});
test('zero remaining clamps usage and settings/reloads cannot extend today', async () => {
  const f = fixture(), b = f.create(); await b.configure(5);
  f.advance(1); await b.add(400000, video);
  assert.equal(b.summary().remaining, 0); assert.equal(b.summary().used, 300000);
  f.advance(1); await b.configure(240); await b.add(2000, video);
  const reopened = f.create(); await reopened.sync();
  assert.equal(reopened.summary().remaining, 0); assert.equal(reopened.summary().limit, 300000);
});
test('midnight applies pending budget and retains historical records and active limits', async () => {
  const f = fixture('2026-10-22T23:59:59'), b = f.create(); await b.configure(60);
  await b.add(500, video); f.advance(1); await b.configure(120);
  f.advance(999); await b.add(1000, video);
  assert.equal(b.day(), '2026-10-23'); assert.equal(b.summary().limit, 7200000);
  assert.equal(b.summary('2026-10-22').used, 500);
  assert.equal(b.summary('2026-10-22').limit, 3600000);
  assert.equal(b.summary().used, 1000);
});
test('local midnight handles DST boundaries without assuming 24 hours', () => {
  const start = new Date('2026-11-01T00:00:00').getTime();
  assert.equal(nextMidnight(start) - start, 25 * 3600000);
  assert.equal(dayKey(nextMidnight(start)), '2026-11-02');
});
test('parallel tabs never overwrite each other and delayed sync never decreases usage', async () => {
  const f = fixture(), a = f.create(), b = f.create(); await a.configure(60); await b.sync(); f.advance(1);
  await Promise.all([a.add(1000, video), b.add(2000, video)]);
  await Promise.all([a.sync(), b.sync()]);
  assert.equal(a.summary().used, 3000); assert.equal(b.summary().used, 3000);
  await Promise.all([a.add(1000, video), b.add(2000, video)]);
  await a.sync(); assert.equal(a.summary().used, 6000);
  const key = [...f.data.keys()].find(k => k.includes('usage:') && k.includes('tab-1'));
  const saved = f.data.get(key); f.data.set(key, { ...saved, ms: 1 });
  await a.sync(); assert.equal(a.summary().used, 6000);
});
test('a stale tab sees the playback lock before changing settings', async () => {
  const f = fixture(), a = f.create(), b = f.create(); await a.configure(60); await b.sync();
  f.advance(1); await a.start(); f.advance(1); await b.configure(120); await a.sync();
  assert.equal(a.summary().limit, 3600000); assert.equal(a.limit('2026-10-23'), 7200000);
});
test('a setting racing an unseen first playback is deferred deterministically', async () => {
  const f = fixture(), b = f.create(); await b.configure(60); f.advance(10); const start = f.now();
  f.advance(10); await b.configure(120);
  await b.write('start:race', { kind: 'start', day: b.day(), at: start });
  assert.equal(b.summary().limit, 3600000); assert.equal(b.limit('2026-10-23'), 7200000);
});
test('warnings are persisted once per day and skip inapplicable thresholds', async () => {
  const f = fixture(), b = f.create(); await b.configure(15); f.advance(1);
  let before = b.summary().remaining; await b.add(300000, video);
  assert.equal(await b.warnings(before), 10); assert.equal(await b.warnings(before), null);
  before = b.summary().remaining; await b.add(300000, video); assert.equal(await b.warnings(before), 5);
  before = b.summary().remaining; await b.add(240000, video); assert.equal(await b.warnings(before), 1);
  const c = f.create(); await c.sync(); assert.equal(await c.warnings(before), null);
  const small = fixture(), d = small.create(); await d.configure(5); await d.add(1000, video);
  assert.equal(await d.warnings(300000), null);
});
test('rolling clock backwards cannot silently create another allowance', async () => {
  const f = fixture(), b = f.create(); await b.configure(60); await b.add(1000, video);
  f.advance(-86400000);
  const reopened = f.create(); await reopened.sync();
  assert.equal(reopened.day(), '2026-10-22'); assert.equal(reopened.summary().used, 1000);
});
test('storage failure rejects rather than silently resetting or falling back to another origin', async () => {
  const b = new Budget(new Store({ async listValues() { throw Error('storage unavailable'); } }), 'tab');
  await assert.rejects(b.configure(60), /storage unavailable/);
});

test('frozen daily budget survives settings with the same millisecond timestamp', async () => {
  const f = fixture(), b = f.create(); await b.configure(60); await b.start();
  await b.configure(240);
  assert.equal(b.summary().limit, 3600000);
  assert.equal(b.limit('2026-10-23'), 14400000);
});
test('visiting a new day without watching persists the last applicable day', async () => {
  const f = fixture(), b = f.create(); await b.configure(60);
  f.advance(86400000); await b.sync(); f.advance(-86400000);
  const c = f.create(); await c.sync();
  assert.equal(c.day(), '2026-10-23');
  assert.equal(c.summary().remaining, 3600000);
});

test('an interval straddling midnight credits both days after the new day was synced', async () => {
  const f = fixture('2026-10-22T23:59:59.500'), b = f.create(); await b.configure(60);
  const start = f.now(); await b.start(); f.advance(1000); await b.sync();
  assert.equal(b.day(), '2026-10-23');
  await b.add(500, video, start, dayKey(start));
  await b.add(500, video, start + 500);
  assert.equal(b.summary('2026-10-22').used, 500);
  assert.equal(b.summary('2026-10-23').used, 500);
});


test('daily chart series fills gaps and keeps chronological local dates', async () => {
  const f = fixture('2026-11-02T12:00:00'), b = f.create(); await b.configure(60);
  await b.add(90000, video);
  const series = dailySeries(b, 7);
  assert.equal(series.length, 7);
  assert.equal(series[0].day, '2026-10-27');
  assert.equal(series[5].day, '2026-11-01');
  assert.equal(series[5].ms, 0);
  assert.deepEqual(series[6], { day: '2026-11-02', ms: 90000 });
  assert.equal(dailySeries(b, 30).length, 30);
});
test('renewal countdown uses hours/minutes and local midnight across DST', () => {
  assert.equal(renewalText('2026-10-22', new Date('2026-10-22T12:00:00').getTime()), 'Renews in 12h 0m');
  assert.equal(renewalText('2026-10-22', new Date('2026-10-22T23:59:59').getTime()), 'Renews in 0h 1m');
  assert.equal(renewalText('2026-11-01', new Date('2026-11-01T00:00:00').getTime()), 'Renews in 25h 0m');
});

test('history sorts by latest watch across rewatches, tabs, and older storage records', async () => {
  const f = fixture(), a = f.create(), b = f.create(); await a.configure(60);
  await a.add(1000, video);
  f.advance(1000);
  const other = { ...video, id: 'zyxwvutsrqp' };
  await a.add(2000, other);
  assert.deepEqual(a.summary().videos.map(v => v.id), [other.id, video.id]);
  f.advance(1000); await b.sync(); await b.add(500, video); await a.sync();
  assert.deepEqual(a.summary().videos.map(v => v.id), [video.id, other.id]);
  assert.equal(a.summary().videos[0].ms, 1500);
  f.advance(1000); await a.add(1000, other);
  assert.equal(a.summary().videos[0].id, other.id);
  await a.write('usage:legacy', { kind: 'usage', day: a.day(), at: f.now() + 1000, ms: 500, video: { ...video, id: 'legacy00000' } });
  assert.equal(a.summary().videos[0].id, 'legacy00000');
  const reopened = f.create(); await reopened.sync();
  assert.deepEqual(reopened.summary().videos.map(v => v.id), a.summary().videos.map(v => v.id));
});
