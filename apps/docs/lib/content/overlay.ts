/**
 * Load content-map.yaml from the repo root and provide typed access.
 * Read once at module init; build is single-shot.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import YAML from 'yaml';
import type { ContentMap } from '@vllm-docs/content-bundle';

const CONTENT_MAP_PATH = path.resolve(process.cwd(), '../../content/content-map.yaml');

let cached: ContentMap | null = null;

export function loadContentMap(): ContentMap {
  if (cached) return cached;
  const raw = readFileSync(CONTENT_MAP_PATH, 'utf-8');
  cached = YAML.parse(raw) as ContentMap;
  return cached;
}
