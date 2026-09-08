import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { startService, serviceRoot } from './helpers/service.js';
import { compareOfficial } from '../scripts/verify-official.mjs';
import { writeStoreZip } from './helpers/trk.js';
import { readTrkFromZip } from '../dist/zip.js';

test('native service: authenticated golden create/correct/export/save/reopen/frame/close', {
  skip: process.env.TRACKER_NATIVE_TESTS !== '1', timeout: 180000,
}, async () => {
  const service = await startService();
  const output = mkdtempSync(join(tmpdir(), 'tracker-service-job-'));
  const call = async (method, params) => {
    const result = await service.request(method, params);
    assert.equal(result?.ok, true, JSON.stringify(result) + '\n' + service.logs());
    assert.equal(result.visible_windows, 0, 'service exposed a visible AWT window');
    return result;
  };
  try {
    const slow = createConnection({ host: '127.0.0.1', port: service.info.port });
    slow.on('error', () => {});
    await new Promise(resolve => slow.once('connect', resolve));
    slow.write('{');
    const drip = setInterval(() => { if (!slow.destroyed) slow.write(' '); }, 250);
    let deadline;
    try {
      await Promise.race([call('status', {}), new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error('unauthenticated slow client blocked owner status')), 8000);
      })]);
    } finally { clearTimeout(deadline); clearInterval(drip); slow.destroy(); }
    const unauthorized = await service.request('open', { path: join(serviceRoot, 'fixtures/golden/synthetic-parabola.mp4') }, '0'.repeat(64));
    assert.equal(unauthorized?.ok, false);
    const forbiddenXml = join(output, 'forbidden.trk');
    writeFileSync(forbiddenXml, '<!DOCTYPE object [<!ENTITY secret SYSTEM "file:///not-a-real-tracker-input">]><object class="org.opensourcephysics.cabrillo.tracker.TrackerPanel">&secret;</object>');
    assert.equal((await service.request('open', { path: forbiddenXml })).ok, false);
    const traversal = join(output, 'traversal.trz');
    writeStoreZip(traversal, [{ name: '../escape.txt', data: 'must not be extracted' }, { name: 'bad.trk', data: '<object class="java.lang.Runtime"/>' }]);
    assert.equal((await service.request('open', { path: traversal })).ok, false);
    assert.equal(existsSync(join(output, '../escape.txt')), false);
    const unsupported = join(output, 'unsupported.trk');
    const original = readTrkFromZip(readFileSync(join(serviceRoot, 'fixtures/official/service-generated.trz')), 'service-generated.trz');
    assert.equal(original.ok, true);
    const unsupportedXml = original.xml.replace('class="org.opensourcephysics.cabrillo.tracker.PointMass"', 'class="org.opensourcephysics.cabrillo.tracker.DynamicParticle"');
    assert.notEqual(unsupportedXml, original.xml);
    writeFileSync(unsupported, unsupportedXml);
    assert.equal((await service.request('open', { path: unsupported })).error?.code, 'UNSUPPORTED_TYPE');
    const corruptVideo = join(output, 'corrupt.mp4');
    writeFileSync(corruptVideo, Buffer.from([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0]));
    const decodeError = await service.request('open', { path: corruptVideo, timeout_ms: 5000 });
    assert.equal(decodeError.error.code, 'VIDEO_DECODE');
    const opened = await call('open', { path: join(serviceRoot, 'fixtures/golden/synthetic-parabola.mp4') });
    const session_id = opened.session_id;
    assert.equal(typeof session_id, 'string');
    const second = await service.request('open', { path: join(serviceRoot, 'fixtures/golden/synthetic-parabola.mp4') });
    assert.equal(second.error.code, 'SESSION_BUSY');
    const stale = await service.request('control', { action: 'status', session_id: 'wrong' });
    assert.equal(stale.error.code, 'NO_SESSION');
    await call('coords', { session_id, origin_x: 96, origin_y: 168, angle_rad: Math.PI / 6, scale: 40, length_unit: 'm' });
    const tiny = await service.request('track', { session_id, name: 'invalid tiny mass', mass: 1e-100 });
    assert.equal(tiny.error?.code, 'INVALID_ARGUMENT', 'Tracker must not silently clamp requested mass');
    await call('track', { session_id, name: 'synthetic mass', mass: 1, type: 'point_mass' });
    const marks = Array.from({ length: 12 }, (_, frame) => ({ frame, x: 48 + 10 * frame + frame * frame, y: 190 - 7 * frame }));
    await call('mark', { session_id, track: 'synthetic mass', marks });
    const csvPath = join(output, 'created.csv');
    await call('export', { session_id, track: 'synthetic mass', path: csvPath, format: 'csv' });
    const baseline = readFileSync(csvPath, 'utf8');
    compareOfficial(readFileSync(join(serviceRoot, 'fixtures/official/official.csv'), 'utf8'), baseline);
    const invalid = await service.request('mark', { session_id, track: 'synthetic mass', marks: [
      { frame: 0, x: 100, y: 100 }, { frame: 999999, x: 0, y: 0 },
    ] });
    assert.equal(invalid.error.code, 'INVALID_ARGUMENT');
    const afterInvalid = join(output, 'after-invalid.csv');
    await call('export', { session_id, track: 'synthetic mass', path: afterInvalid });
    assert.equal(readFileSync(afterInvalid, 'utf8'), baseline, 'invalid batch partially mutated marks');
    await call('mark', { session_id, track: 'synthetic mass', clear: true, marks: [{ frame: 5 }, { frame: 6 }] });
    const gapPath = join(output, 'gap.csv');
    await call('export', { session_id, track: 'synthetic mass', path: gapPath });
    assert.equal(readFileSync(gapPath, 'utf8').trim().split('\n').length, 11);
    await call('mark', { session_id, track: 'synthetic mass', marks: [marks[5], marks[6]] });
    const framePath = join(output, 'frame7.png');
    await call('frame', { session_id, frame: 7, path: framePath });
    assert.deepEqual([...readFileSync(framePath).subarray(0, 8)], [137,80,78,71,13,10,26,10]);
    const pixels = spawnSync('python3', ['-c',
      'import cv2,numpy as np,sys,json; im=cv2.imread(sys.argv[1]); ys,xs=np.where((im[:,:,2]>180)&(im[:,:,1]>160)&(im[:,:,0]<140)); print(json.dumps([round(float(xs.mean())),round(float(ys.mean()))]))', framePath],
      { encoding: 'utf8', timeout: 10000 });
    assert.equal(pixels.status, 0, pixels.stderr);
    assert.deepEqual(JSON.parse(pixels.stdout), [167, 141], 'frame_get returned stale/wrong pixels');
    const archive = join(output, 'project.trz');
    const saved = await call('control', { session_id, action: 'save', path: archive });
    assert.ok(existsSync(archive));
    assert.ok(isAbsolute(saved.trz_path));
    const bytes = readFileSync(archive);
    const overwrite = await service.request('control', { session_id, action: 'save', path: archive });
    assert.equal(overwrite.ok, false);
    assert.deepEqual(readFileSync(archive), bytes, 'existing output overwritten');
    await call('control', { session_id, action: 'close' });
    const reopened = await call('open', { path: archive });
    assert.notEqual(reopened.session_id, session_id);
    const reloadedPath = join(output, 'reloaded.csv');
    await call('export', { session_id: reopened.session_id, track: 'synthetic mass', path: reloadedPath });
    compareOfficial(readFileSync(join(serviceRoot, 'fixtures/official/official.csv'), 'utf8'), readFileSync(reloadedPath, 'utf8'));
    await call('control', { session_id: reopened.session_id, action: 'close' });
    const anisotropicPath = join(output, 'anisotropic.trk');
    const savedXml = readFileSync(saved.trk_path, 'utf8');
    const anisotropicXml = savedXml.replace(/(name="yscale"[^>]*>)[^<]+/, '$180.0');
    assert.notEqual(anisotropicXml, savedXml);
    writeFileSync(anisotropicPath, anisotropicXml);
    const anisotropic = await call('open', { path: anisotropicPath });
    const before = await call('export', { session_id: anisotropic.session_id, track: 'synthetic mass' });
    await call('coords', { session_id: anisotropic.session_id, origin_x: 96 });
    const after = await call('export', { session_id: anisotropic.session_id, track: 'synthetic mass' });
    assert.deepEqual(after.rows, before.rows, 'origin-only update must preserve Y scale');
    await call('control', { session_id: anisotropic.session_id, action: 'close' });
    const official = await call('open', { path: join(serviceRoot, 'fixtures/official/official.trz') });
    const officialExport = join(output, 'official-recomputed.csv');
    await call('export', { session_id: official.session_id, track: 'synthetic mass', path: officialExport });
    compareOfficial(readFileSync(join(serviceRoot, 'fixtures/official/official.csv'), 'utf8'), readFileSync(officialExport, 'utf8'));
    await call('control', { session_id: official.session_id, action: 'close' });
  } finally { await service.close(); }
});
