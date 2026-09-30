/**
 * Pixel comparison with change-region extraction. Images of different
 * heights (content grew or shrank) are padded, so size changes count as
 * differences instead of breaking the comparison.
 */
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { Rect } from '@pixelforge/core';

export interface DiffResult {
  mismatched: number;
  ratio: number;
  width: number;
  height: number;
  diffPng: Buffer;
  regions: Rect[];
}

function pad(img: PNG, width: number, height: number): PNG {
  if (img.width === width && img.height === height) return img;
  const out = new PNG({ width, height });
  out.data.fill(0);
  PNG.bitblt(img, out, 0, 0, img.width, img.height, 0, 0);
  return out;
}

export function diffImages(aBuf: Buffer, bBuf: Buffer, cell = 16): DiffResult {
  const a0 = PNG.sync.read(aBuf);
  const b0 = PNG.sync.read(bBuf);
  const width = Math.max(a0.width, b0.width);
  const height = Math.max(a0.height, b0.height);
  const a = pad(a0, width, height);
  const b = pad(b0, width, height);
  const diff = new PNG({ width, height });
  const mismatched = pixelmatch(a.data, b.data, diff.data, width, height, { threshold: 0.1, alpha: 0.25, diffColor: [255, 64, 96], aaColor: [255, 210, 0] });
  // Region extraction on a coarse grid of changed cells.
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const grid = new Uint8Array(cols * rows);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (diff.data[i] === 255 && diff.data[i + 1] === 64 && diff.data[i + 2] === 96) grid[Math.floor(y / cell) * cols + Math.floor(x / cell)] = 1;
    }
  }
  const regions: Rect[] = [];
  const seen = new Uint8Array(cols * rows);
  for (let i = 0; i < grid.length; i++) {
    if (!grid[i] || seen[i]) continue;
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      const cx = j % cols;
      const cy = Math.floor(j / cols);
      minX = Math.min(minX, cx); maxX = Math.max(maxX, cx); minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
      // 8-neighbourhood with a one-cell gap tolerance merges nearby changes.
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const k = ny * cols + nx;
          if (grid[k] && !seen[k]) {
            seen[k] = 1;
            stack.push(k);
          }
        }
      }
    }
    regions.push({ x: minX * cell, y: minY * cell, width: Math.min((maxX - minX + 1) * cell, width - minX * cell), height: Math.min((maxY - minY + 1) * cell, height - minY * cell) });
  }
  regions.sort((r1, r2) => r2.width * r2.height - r1.width * r1.height);
  return { mismatched, ratio: mismatched / (width * height), width, height, diffPng: PNG.sync.write(diff), regions: regions.slice(0, 40) };
}
