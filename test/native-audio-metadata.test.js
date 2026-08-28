const assert = require('node:assert/strict');
const { execFile, execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function run(command, args) { return new Promise((resolve, reject) => execFile(command, args, (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(stdout))); }
async function metadata(filePath) { const mm = await import('music-metadata'); return mm.parseFile(filePath); }
const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch (_) { return false; } })();

test('WebM Opus remuxes to Opus with stream copy and canonical tags', { skip: !hasFfmpeg }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playerinyo-native-tags-'));
  const webm = path.join(root, 'input.webm'); const opus = path.join(root, 'output.opus');
  try {
    await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libopus', webm]);
    const before = await metadata(webm);
    await run('ffmpeg', ['-y', '-i', webm, '-map', '0:a:0', '-c:a', 'copy', '-metadata', 'title=Dirge', '-metadata', 'artist=Death in Vegas', '-metadata', 'album=The Contino Sessions', '-f', 'opus', opus]);
    const after = await metadata(opus);
    assert.match(String(after.format.codec), /opus/i);
    assert.ok(Math.abs(after.format.duration - before.format.duration) < 0.05);
    assert.equal(after.common.title, 'Dirge'); assert.equal(after.common.artist, 'Death in Vegas'); assert.equal(after.common.album, 'The Contino Sessions');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('M4A metadata remux keeps AAC codec', { skip: !hasFfmpeg }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playerinyo-native-tags-'));
  const source = path.join(root, 'input.m4a'); const output = path.join(root, 'output.m4a');
  try {
    await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'aac', source]);
    const before = await metadata(source);
    await run('ffmpeg', ['-y', '-i', source, '-map', '0', '-c', 'copy', '-metadata', 'title=Canonical Title', output]);
    const after = await metadata(output);
    assert.match(String(before.format.codec), /aac/i); assert.match(String(after.format.codec), /aac/i);
    assert.equal(after.common.title, 'Canonical Title');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
