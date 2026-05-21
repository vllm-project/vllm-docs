/**
 * Map a page to its section, and produce the in-section nav tree.
 *
 * Section assignment: first section whose `paths` glob matches wins.
 * Pages with no matching section land in a synthetic "Misc" group.
 */
import { minimatch } from 'minimatch';
import type {
  Bundle,
  ContentMap,
  Page,
  SectionDef
} from '@vllm-docs/content-bundle';

const MISC_SECTION: SectionDef = {
  id: 'misc',
  label: 'Misc',
  paths: ['**']
};

export function findSection(page: Page, map: ContentMap): SectionDef {
  for (const s of map.sections) {
    if (s.paths.some((g) => minimatch(page.path, g))) return s;
  }
  return MISC_SECTION;
}

/** A path is "literal" if it contains no glob meta-characters. Literal
 *  entries in `sections[].paths` are an explicit claim by that section. */
function isLiteralPath(p: string): boolean {
  return !/[*?[\]{}]/.test(p);
}

/** Returns the section that explicitly (i.e. via a literal, non-glob path)
 *  claims this page, or null if no section names it literally. Used to
 *  stop one section's sidebar_group from cross-section-pulling a page
 *  that another section has put on its own paths list. */
function explicitlyClaimingSection(
  pagePath: string,
  sections: readonly SectionDef[]
): SectionDef | null {
  for (const s of sections) {
    for (const pat of s.paths) {
      if (isLiteralPath(pat) && pat === pagePath) return s;
    }
  }
  return null;
}

export function pagesInSection(
  bundle: Bundle,
  section: SectionDef,
  contentMap?: ContentMap
): Page[] {
  // A page belongs to exactly one section — the first whose paths glob
  // matches (same rule as findSection). Filtering by that here keeps a
  // page from showing up in multiple sidebars when its glob is broad
  // (e.g. features/**) but a more specific section claimed it first.
  if (!contentMap) {
    return Object.values(bundle.pages).filter((p) =>
      section.paths.some((g) => minimatch(p.path, g))
    );
  }
  return Object.values(bundle.pages).filter(
    (p) => findSection(p, contentMap).id === section.id
  );
}

export function landingPathFor(
  bundle: Bundle,
  section: SectionDef
): string | undefined {
  if (section.landing && bundle.pages[section.landing]) {
    return bundle.pages[section.landing]?.slug;
  }
  const pages = pagesInSection(bundle, section);
  if (pages.length === 0) return undefined;
  pages.sort((a, b) => a.path.localeCompare(b.path));
  return pages[0]?.slug;
}

/** Resolve a section's tab href: prefer `landing_url` (custom landing route),
 *  then `landing` markdown page, then the section's first page. Returns `/`
 *  as a last-resort fallback so the tab is never dead. */
export function sectionHref(bundle: Bundle, section: SectionDef): string {
  if (section.landing_url) return section.landing_url;
  const slug = landingPathFor(bundle, section);
  return slug ? `/${slug}` : '/';
}

export interface NavExternal {
  title: string;
  href: string;
  /** Internal Next route vs external new-tab link. */
  internal: boolean;
}

export interface NavGroup {
  /** Display label for the sidebar group. Derived from first path segment. */
  label: string;
  /** Pages within this group, ordered. */
  pages: Page[];
  /** Optional external links rendered after the pages (open in new tab). */
  externals?: NavExternal[];
}

const SEGMENT_LABELS: Record<string, string> = {
  getting_started: 'Getting started',
  usage: 'Usage',
  examples: 'Examples',
  serving: 'Inference & serving',
  deployment: 'Deployment',
  features: 'Features',
  models: 'Models',
  training: 'Training',
  configuration: 'Configuration',
  api: 'API reference',
  cli: 'CLI reference',
  benchmarking: 'Benchmarking',
  design: 'Design docs',
  contributing: 'Contributing',
  governance: 'Governance',
  community: 'Community'
};

function labelFor(segment: string): string {
  return (
    SEGMENT_LABELS[segment] ??
    segment
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/**
 * Build the sidebar nav for a section.
 *
 * Two layouts:
 *   1. If `contentMap.sidebar_groups[section.id]` exists, use the curated
 *      sub-groups: each `{label, paths}` becomes one NavGroup. Pages matched
 *      by any path/glob are placed in that group (in listed order); the rest
 *      fall into a final "More" group.
 *   2. Otherwise fall back to grouping by first directory segment, with
 *      single-segment files in an "Overview" group above.
 *
 * In both layouts, `contentMap.nav_order[groupLabel]` may further reorder
 * pages within a group; uncurated pages fall through to README-first +
 * alphabetic by title.
 */
export function buildNav(
  bundle: Bundle,
  section: SectionDef,
  contentMap?: ContentMap
): NavGroup[] {
  // Pages we never show in the rail:
  //   - per-page overlay hidden_in_sidebar
  //   - path matching a glob in sidebar_hidden_globs (e.g. "examples/**")
  //   - non-root `<dir>/README.md` UNLESS the section's sidebar_groups
  //     explicitly names it (so authors can opt a specific README in as
  //     a topic landing — e.g. features/speculative_decoding/README.md
  //     becomes the "Speculative Decoding" overview entry).
  const hiddenGlobs = contentMap?.sidebar_hidden_globs ?? [];
  const sectionGroups = contentMap?.sidebar_groups?.[section.id] ?? [];
  const explicitReadmeWhitelist = new Set<string>();
  for (const g of sectionGroups) {
    for (const p of g.paths) {
      if (!/[*?[\]]/.test(p) && /\/README\.md$/.test(p)) {
        explicitReadmeWhitelist.add(p);
      }
    }
  }

  const pages = pagesInSection(bundle, section, contentMap).filter((p) => {
    if (contentMap?.pages?.[p.path]?.hidden_in_sidebar) return false;
    if (hiddenGlobs.some((g) => minimatch(p.path, g))) return false;
    if (/.+\/README\.md$/.test(p.path) && !explicitReadmeWhitelist.has(p.path)) return false;
    return true;
  });
  const navOrder = contentMap?.nav_order ?? {};

  const sortFor = (label: string) => (a: Page, b: Page) => {
    const order = navOrder[label] ?? [];
    const aIdx = order.indexOf(a.path);
    const bIdx = order.indexOf(b.path);
    if (aIdx !== -1 || bIdx !== -1) {
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    }
    const aReadme = /\/(README|index)\.md$/i.test(a.path) || a.path === 'README.md' ? 0 : 1;
    const bReadme = /\/(README|index)\.md$/i.test(b.path) || b.path === 'README.md' ? 0 : 1;
    if (aReadme !== bReadme) return aReadme - bReadme;
    return a.title.localeCompare(b.title);
  };

  // Curated sub-grouping path.
  const curated = contentMap?.sidebar_groups?.[section.id];
  if (curated && curated.length > 0) {
    const remaining = new Map<string, Page>();
    for (const p of pages) remaining.set(p.path, p);
    // Cross-section references: groups may pull pages whose home section
    // is somewhere else (e.g. "Run a server" inside Start pulls from
    // serving/). Looked up against the full bundle, not just this section.
    const seenCrossSection = new Set<string>();

    const result: NavGroup[] = [];
    for (const g of curated) {
      const matched: Page[] = [];
      for (const pattern of g.paths) {
        // First: pages owned by this section.
        for (const [key, page] of remaining) {
          if (minimatch(key, pattern)) {
            matched.push(page);
            remaining.delete(key);
          }
        }
        // Then: pages from other sections, deduped across groups.
        for (const [key, page] of Object.entries(bundle.pages)) {
          if (seenCrossSection.has(key)) continue;
          if (matched.includes(page)) continue;
          if (remaining.has(key)) continue;
          // Don't pull a page that another section claims by a literal
          // (non-glob) path — that's a deliberate move authored in
          // content-map, and we shouldn't ghost-duplicate it back here.
          const owner = explicitlyClaimingSection(key, contentMap?.sections ?? []);
          if (owner && owner.id !== section.id) continue;
          if (minimatch(key, pattern)) {
            matched.push(page);
            seenCrossSection.add(key);
          }
        }
      }
      const externals: NavExternal[] = (g.external_links ?? []).map((l) => ({
        title: l.title,
        href: l.href,
        internal: l.internal ?? l.href.startsWith('/')
      }));
      if (matched.length === 0 && externals.length === 0) continue;
      matched.sort((a, b) => {
        const ai = g.paths.findIndex((pat) => minimatch(a.path, pat));
        const bi = g.paths.findIndex((pat) => minimatch(b.path, pat));
        if (ai !== bi) return ai - bi;
        return sortFor(g.label)(a, b);
      });
      result.push({ label: g.label, pages: matched, externals: externals.length ? externals : undefined });
    }
    if (remaining.size > 0) {
      const leftover = Array.from(remaining.values()).sort(sortFor('More'));
      result.push({ label: 'More', pages: leftover });
    }
    return result;
  }

  // Default: directory-segment grouping.
  const root: Page[] = [];
  const groups = new Map<string, Page[]>();

  for (const p of pages) {
    const parts = p.path.split('/');
    if (parts.length === 1) {
      root.push(p);
    } else {
      const seg = parts[0]!;
      if (!groups.has(seg)) groups.set(seg, []);
      groups.get(seg)!.push(p);
    }
  }

  root.sort(sortFor('Overview'));
  for (const [seg, arr] of groups.entries()) {
    arr.sort(sortFor(labelFor(seg)));
  }

  const result: NavGroup[] = [];
  if (root.length > 0) result.push({ label: 'Overview', pages: root });
  const sortedKeys = Array.from(groups.keys()).sort();
  for (const k of sortedKeys) {
    result.push({ label: labelFor(k), pages: groups.get(k)! });
  }
  return result;
}
