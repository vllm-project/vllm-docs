/**
 * Load the built bundle.json from disk. Single-version site — we always
 * load `bundle/latest/bundle.json`. The `Version` type and the per-version
 * directory layout are kept so the multi-version path is recoverable
 * later (CI just needs to start producing the other bundles again).
 */
import { readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import type { Bundle } from '@vllm-docs/content-bundle';

const VERSION = 'latest';
const BUNDLE_PATH = path.resolve(process.cwd(), '../..', 'bundle', VERSION, 'bundle.json');

let cached: Bundle | null = null;

export function loadBundle(): Bundle {
  if (cached) return cached;
  if (!existsSync(BUNDLE_PATH)) {
    throw new Error(`bundle not found at ${BUNDLE_PATH}. Run: pnpm bundle:latest`);
  }
  cached = JSON.parse(readFileSync(BUNDLE_PATH, 'utf-8')) as Bundle;
  return cached;
}

export function bundleExists(): boolean {
  return existsSync(BUNDLE_PATH);
}
