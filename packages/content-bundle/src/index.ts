// Bundle schema shared between extractor output and Next.js consumer.
// Keep this stable; extractor writes JSON conforming to these types.

export type Version = 'stable' | 'latest' | 'nightly';

export type TemplateName = 'start' | 'guide' | 'concept' | 'reference' | 'contribute' | 'intro';

export interface BundleMeta {
  version: Version;
  vllmRef: string;          // git ref used at build time (e.g. "main", "v0.6.4")
  vllmSha: string;          // resolved commit SHA
  builtAt: string;          // ISO timestamp
  schemaVersion: 1;
}

export interface Heading {
  depth: number;            // 1-6
  text: string;
  slug: string;
}

export interface Page {
  /** Path relative to docs root, e.g. "getting_started/quickstart.md" */
  path: string;
  /** URL slug without extension, e.g. "getting_started/quickstart" */
  slug: string;
  title: string;
  rawMarkdown: string;
  headings: Heading[];
  /** Frontmatter fields (rare in vLLM docs but supported). */
  frontmatter: Record<string, unknown>;
  /** GitHub edit URL pointing back at the source file. */
  editUrl: string;
  /** Estimated reading time in minutes (200 wpm); rounded up, min 1. */
  readMinutes: number;
}

export interface NavNode {
  title: string;
  slug?: string;
  children?: NavNode[];
}

export interface RefsTable {
  /** Heading slug -> absolute URL within the version. */
  headings: Record<string, string>;
  /** Python symbol path -> absolute URL within the version. */
  symbols: Record<string, string>;
}

export interface Bundle {
  meta: BundleMeta;
  pages: Record<string, Page>;
  nav: NavNode[];
  refs: RefsTable;
  /** Reserved for extractor outputs (filled in later phases). */
  api?: unknown;
  cli?: unknown;
  metrics?: unknown;
}

export interface SectionDef {
  /** Stable id used in URLs and component keys. */
  id: string;
  /** Visible label in the top tab bar. */
  label: string;
  /** Globs for pages that belong to this section. First match wins. */
  paths: string[];
  /** Optional landing page (markdown path). Falls back to first sidebar entry. */
  landing?: string;
  /** Optional in-site URL (no version prefix) for a hand-crafted landing.
   *  Takes precedence over `landing` when set. e.g. "/start". */
  landing_url?: string;
  /** Render as a smaller, muted link at the right of the tab bar instead of
   *  a primary tab. Used for low-traffic top-level destinations (Concepts,
   *  Contribute) so the primary user paths don't compete for attention. */
  secondary?: boolean;
}

/** Page-level toggles applied via PageOverlay. Currently the only one. */
export interface PageVisibility {
  /** When true, the page is excluded from the sidebar. URLs still work and
   *  the page can be reached via in-page cards or direct links. Used when
   *  a page is embedded as a card inside another page (e.g. Docker /
   *  Claude Code surfaced inside Quickstart). */
  hidden_in_sidebar?: boolean;
}

export interface ContentMapRule {
  match: string;            // glob (minimatch)
  template: TemplateName;
}

export interface ContentMapTitleHint {
  keyword: string | string[];
  template: TemplateName;
}

export type HeroMediaType = 'image' | 'video' | 'svg' | 'youtube';

export interface HeroMedia {
  type: HeroMediaType;
  /** For image/svg: doc-relative or absolute URL (resolved by asset-paths).
   *  For video: direct mp4/webm URL.
   *  For youtube: 11-char video id (e.g. "dQw4w9WgXcQ"). */
  src: string;
  alt?: string;
  caption?: string;
  /** Width:height — used to reserve aspect-ratio space and avoid CLS. */
  aspect?: string; // e.g. "16/9", "4/3"
}

export interface PageOverlay {
  template?: TemplateName;
  audience?: string;
  task?: string;
  /** TL;DR text shown in a card below the page header. Plain prose, 1-3 sentences. */
  summary?: string;
  /** Override the auto-computed reading time (minutes). */
  read_minutes?: number;
  /** Difficulty tier: 1 = beginner, 2 = intermediate, 3 = advanced. */
  difficulty?: 1 | 2 | 3;
  /** Big media block rendered between the page header and the doc body. */
  hero?: HeroMedia;
  /** Plain-language motivation: "Before X existed, life looked like Y. X
   *  solves Z." Rendered as a "Why does this exist?" block above the body. */
  why?: string;
  /** Single concrete analogy that gives readers a working mental model.
   *  Rendered as a yellow "Mental model" callout below `why`. */
  analogy?: string;
  /** End-of-page exercises — "Try this" prompts the reader can run to
   *  internalize the page. Rendered as a numbered list before Related. */
  exercises?: string[];
  related_recipes?: string[];
  related_benchmarks?: string[];
  related_guides?: string[];
  related_concepts?: string[];
  next_steps?: string[];
  homepage_featured?: boolean;
  badges?: string[];
  /** Hide from sidebar nav. Useful when the page is surfaced inline as a
   *  card inside another page. */
  hidden_in_sidebar?: boolean;
}

export interface SidebarExternalLink {
  /** Visible label in the sidebar. */
  title: string;
  /** URL — absolute (external, opens in new tab) or root-relative (internal,
   *  rendered as a normal Link with active highlighting). */
  href: string;
  /** When true, treat as an internal route (Next Link, no target=_blank,
   *  no external icon). Auto-detected from `href` when omitted: a leading
   *  "/" implies internal. */
  internal?: boolean;
}

export interface SidebarGroup {
  /** Visible label in the sidebar (e.g. "Run a server", "Scale across machines"). */
  label: string;
  /** Page paths or globs (minimatch) that belong to this group, in order. */
  paths: string[];
  /** Optional external links, rendered after the matched pages. Use sparingly
   *  — most "integrations" are upstream md pages, but a few (e.g. companion
   *  projects with their own docs) only have an external URL. */
  external_links?: SidebarExternalLink[];
}

export interface ContentMap {
  defaults: { template: TemplateName };
  sections: SectionDef[];
  rules: ContentMapRule[];
  title_hints: ContentMapTitleHint[];
  pages: Record<string, PageOverlay>;
  /** Hand-curated sidebar ordering, keyed by group label (e.g. "Inference & serving").
   *  Each entry is a list of page paths in the order they should appear.
   *  Pages not listed fall back to alphabetic-by-title after the curated ones. */
  nav_order?: Record<string, string[]>;
  /** Hand-curated sidebar sub-grouping, keyed by section id. Overrides the
   *  default directory-derived single-group layout. Pages within the section
   *  but not matched by any group fall into a "More" group at the end. */
  sidebar_groups?: Record<string, SidebarGroup[]>;
  /** Page-path globs that should be excluded from every section sidebar.
   *  The pages still exist (URLs resolve, search indexes them, inline cards
   *  link to them); they just don't appear in the rail. Use sparingly — for
   *  things like auto-generated example pages where the rail entry adds
   *  noise but the page itself is useful. */
  sidebar_hidden_globs?: string[];
}
