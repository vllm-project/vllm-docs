/**
 * Build a per-version search index from bundle/<version>/bundle.json.
 *
 * The index is shaped to be tiny enough to embed in the client at first paint:
 *   { docs: [{ id, title, slug, section, body }], options: {...} }
 *
 * `body` is a stripped-markdown excerpt — long enough for relevance, short
 * enough for an under-1MB index per version. Trimmed to the first 1500 chars
 * after stripping markup, headings, code blocks, etc.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import YAML from 'yaml';
import { minimatch } from 'minimatch';
import type { Bundle, ContentMap, Version } from '@vllm-docs/content-bundle';

const ROOT = path.resolve(process.cwd(), '../..');

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/!\[.*?\]\(.*?\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface IndexedDoc {
  id: string;
  title: string;
  slug: string;
  section: string;
  excerpt: string;
  body: string;
}

async function buildOne(version: Version, bundle: Bundle, contentMap: ContentMap): Promise<void> {
  const docs: IndexedDoc[] = [];
  for (const page of Object.values(bundle.pages)) {
    const stripped = stripMarkdown(page.rawMarkdown);
    const section =
      contentMap.sections.find((s) => s.paths.some((g) => minimatch(page.path, g)))?.id ?? 'misc';
    docs.push({
      id: page.path,
      title: page.title,
      slug: page.slug,
      section,
      excerpt: stripped.slice(0, 220),
      body: stripped.slice(0, 1500)
    });
  }

  const out = {
    version,
    builtAt: bundle.meta.builtAt,
    vllmRef: bundle.meta.vllmRef,
    docs
  };

  const outDir = path.resolve(ROOT, 'apps/docs/public');
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.resolve(outDir, `search-${version}.json`);
  await fs.writeFile(outFile, JSON.stringify(out));
  const sizeKb = ((await fs.stat(outFile)).size / 1024).toFixed(1);
  console.log(`  search-${version}.json  (${docs.length} docs, ${sizeKb} KB)`);
}

async function main(): Promise<void> {
  const contentMapRaw = await fs.readFile(
    path.resolve(ROOT, 'content/content-map.yaml'),
    'utf-8'
  );
  const contentMap = YAML.parse(contentMapRaw) as ContentMap;

  const versions: Version[] = ['stable', 'latest', 'nightly'];
  for (const v of versions) {
    const bundlePath = path.resolve(ROOT, 'bundle', v, 'bundle.json');
    try {
      const bundleRaw = await fs.readFile(bundlePath, 'utf-8');
      const bundle = JSON.parse(bundleRaw) as Bundle;
      await buildOne(v, bundle, contentMap);
    } catch {
      // bundle missing for this version → skip
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
