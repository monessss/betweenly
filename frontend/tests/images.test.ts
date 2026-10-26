import test from 'node:test';
import assert from 'node:assert/strict';
import { photoDimensions, validatePhotoFile } from '../src/lib/images.ts';

test('photo uploads accept supported rasters and reject active or oversized files', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) validatePhotoFile({ type, size: 1024 });
  for (const type of ['image/svg+xml', 'text/html', 'image/gif', '']) assert.throws(() => validatePhotoFile({ type, size: 100 }));
  for (const size of [0, 8 * 1024 * 1024 + 1]) assert.throws(() => validatePhotoFile({ type: 'image/jpeg', size }));
});
test('photo sizing preserves aspect ratio and bounds decoded pixel counts', () => {
  assert.deepEqual(photoDimensions(4000, 3000), { width: 1600, height: 1200 });
  assert.deepEqual(photoDimensions(300, 500), { width: 300, height: 500 });
  assert.deepEqual(photoDimensions(1, 10000), { width: 1, height: 1600 });
  for (const [width, height] of [[0, 1], [NaN, 5], [20000, 20000]]) assert.throws(() => photoDimensions(width, height));
});
