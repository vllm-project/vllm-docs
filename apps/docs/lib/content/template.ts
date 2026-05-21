/**
 * Decide which template to use for a page, with no markdown frontmatter required.
 *
 * Priority:
 *   1. content-map.yaml `pages[path].template`
 *   2. content-map.yaml `rules[].match` (first hit wins)
 *   3. content-map.yaml `title_hints[].keyword` (substring, case-insensitive)
 *   4. defaults.template
 */
import { minimatch } from 'minimatch';
import type { ContentMap, Page, TemplateName } from '@vllm-docs/content-bundle';

export function inferTemplate(page: Page, map: ContentMap): TemplateName {
  // 1. explicit overlay
  const explicit = map.pages[page.path]?.template;
  if (explicit) return explicit;

  // 2. path rules
  for (const rule of map.rules) {
    if (minimatch(page.path, rule.match)) return rule.template;
  }

  // 3. title hints
  const titleLower = page.title.toLowerCase();
  for (const hint of map.title_hints) {
    const kws = Array.isArray(hint.keyword) ? hint.keyword : [hint.keyword];
    if (kws.some((kw) => titleLower.includes(kw.toLowerCase()))) {
      return hint.template;
    }
  }

  // 4. fallback
  return map.defaults.template;
}
