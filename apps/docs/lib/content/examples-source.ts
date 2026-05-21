/**
 * Build a lookup map from `examples/<dir>/<basename>` source paths to the
 * embedded code, language, and GitHub URL. The bundle stores each example
 * file as a synthesized page whose rawMarkdown is `# Title\n\n[View source
 * on GitHub](URL)\n\n```<lang>\n<code>\n```\n`. We parse that back into a
 * fast lookup so the markdown preprocessor can inline the code inside a
 * `<details>` element instead of routing off to a separate page.
 */
import type { Bundle } from '@vllm-docs/content-bundle';

export interface ExampleSource {
  code: string;
  lang: string;
  ghUrl?: string;
}

let cache: { bundle: Bundle; map: Record<string, ExampleSource> } | null = null;

export function buildExamplesMap(bundle: Bundle): Record<string, ExampleSource> {
  if (cache && cache.bundle === bundle) return cache.map;

  const map: Record<string, ExampleSource> = {};
  for (const page of Object.values(bundle.pages)) {
    if (!page.path.startsWith('examples/')) continue;
    const ghMatch = page.rawMarkdown.match(
      /\[View source on GitHub\]\((https?:[^)]+)\)/
    );
    const codeMatch = page.rawMarkdown.match(/```(\w*)\n([\s\S]*?)```/);
    if (!ghMatch || !codeMatch) continue;
    const ghUrl = ghMatch[1]!;
    const lang = codeMatch[1] ?? '';
    const code = codeMatch[2]!.replace(/\n+$/, '');
    // Reconstruct the source-relative path from the GitHub blob URL:
    // https://github.com/vllm-project/vllm/blob/<ref>/examples/<dir>/<file>
    const urlMatch = ghUrl.match(/\/blob\/[^/]+\/(.+)$/);
    if (!urlMatch) continue;
    const sourceRel = urlMatch[1]!;
    map[sourceRel] = { code, lang, ghUrl };
  }

  cache = { bundle, map };
  return map;
}
