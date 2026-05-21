import { rewriteAssetUrl } from './asset-paths';
import type { ExampleSource } from '@/lib/content/examples-source';

/**
 * Source-level preprocessor for mkdocs-material block syntax.
 *
 * Translates the three block forms used in vLLM upstream docs into HTML
 * wrappers that survive the unified pipeline (remark-rehype + rehype-stringify
 * with allowDangerousHtml). The body of each block is dedented and re-emitted
 * as markdown surrounded by blank lines, so CommonMark resumes parsing it
 * normally between the raw HTML envelopes.
 *
 *   !!! type "title"          — admonition (type optional title; "" suppresses)
 *       indented body
 *
 *   ??? type "title"          — collapsible admonition (closed)
 *   ???+ type "title"         — collapsible admonition (open)
 *
 *   === "Tab label"           — content tab. Consecutive === blocks at the
 *       indented body           same indent merge into one tab container.
 *
 *   [TOC]                     — Python-Markdown table-of-contents marker;
 *                               removed (we render TOC in the right rail).
 *
 * Only column-0 headers are recognized. Bodies must use 4-space indent
 * (mkdocs-material default). Nested mkdocs blocks are supported via a
 * recursive call on the dedented body.
 */
const HEADER_RE =
  /^(?<prefix>!!!|\?\?\?\+?|===)[ \t]+(?<type>"(?:\\"|[^"])*"|[^\s"]+)(?:[ \t]+"(?<title>(?:\\"|[^"])*)")?[ \t]*$/;

const ADMON_LABEL: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
  danger: 'Danger',
  info: 'Info',
  success: 'Success',
  question: 'Question',
  failure: 'Failure',
  bug: 'Bug',
  example: 'Example',
  abstract: 'Abstract',
  summary: 'Summary',
  quote: 'Quote',
  announcement: 'Announcement',
  console: 'Console',
  code: 'Code'
};

/** Per-call counter object passed through `preprocessMkdocsBlocks` and its
 *  recursive descents so generated tab-group IDs (`tg1`, `tg2`, …) reset
 *  per top-level render. Module-level counter state would otherwise differ
 *  between concurrent renders (e.g. SSR vs RSC payload in Next.js dev mode)
 *  and surface as React hydration mismatches. */
interface TabCounter {
  n: number;
}

function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim() === '';
}

function leadingSpaces(line: string): number {
  let i = 0;
  while (i < line.length && line[i] === ' ') i++;
  return i;
}

function dedent(lines: string[], n: number): string[] {
  return lines.map((l) => {
    if (l.length === 0) return l;
    const ws = leadingSpaces(l);
    return l.slice(Math.min(ws, n));
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

interface Header {
  prefix: '!!!' | '???' | '???+' | '===';
  rawType: string; // exact match — may include quotes for === labels
  type: string; // unquoted, lowercased for !!! / ???; original-case label for ===
  title: string | undefined; // undefined = no title attr; '' = explicit suppress
}

function parseHeader(line: string): Header | null {
  if (leadingSpaces(line) !== 0) return null;
  const m = line.match(HEADER_RE);
  if (!m || !m.groups) return null;
  const prefix = m.groups.prefix as Header['prefix'];
  const rawType = m.groups.type!;
  const unquoted = rawType.startsWith('"') ? rawType.slice(1, -1).replace(/\\"/g, '"') : rawType;
  const type = prefix === '===' ? unquoted : unquoted.toLowerCase();
  return { prefix, rawType, type, title: m.groups.title };
}

/** Collect the indented body of a block starting at index `i`.
 *  Returns dedented body lines and the new index. Trailing blanks are trimmed. */
function collectBody(lines: string[], i: number): { body: string[]; next: number } {
  const body: string[] = [];
  let j = i;
  while (j < lines.length) {
    const l = lines[j]!;
    if (isBlank(l)) {
      body.push(l);
      j++;
      continue;
    }
    if (leadingSpaces(l) >= 4) {
      body.push(l);
      j++;
      continue;
    }
    break;
  }
  while (body.length > 0 && isBlank(body[body.length - 1])) body.pop();
  return { body: dedent(body, 4), next: j };
}

/**
 * Translate mkdocs-material attribute syntax that vanilla CommonMark doesn't
 * understand. `pageDir` is the doc-relative directory of the current page,
 * used to resolve relative image URLs to the public asset mount the same way
 * the AST-based remarkAssetPaths plugin does (we need it here because the
 * inline `<img>` tags emitted below bypass the markdown image AST node).
 */
/**
 * Pull `$$ ... $$` math blocks out of indented contexts (list items,
 * admonition bodies). CommonMark treats 4-space-indented content inside
 * lists as code, which means remark-math never sees them. Re-emit each
 * such block at column 0 surrounded by blank lines so it parses as a
 * standalone math block.
 *
 * Inline `$x$` math is left alone — it's already at the text node level
 * regardless of indent.
 */
function liftIndentedMathBlocks(src: string): string {
  return src.replace(
    /(^|\n)([ \t]+)\$\$[ \t]*\n([\s\S]*?)\n[ \t]+\$\$[ \t]*(?=\n|$)/g,
    (_match, lead: string, _indent: string, inner: string) => {
      const dedented = inner
        .split('\n')
        .map((l) => l.replace(/^[ \t]+/, ''))
        .join('\n')
        .trim();
      return `${lead}\n$$\n${dedented}\n$$\n`;
    }
  );
}

/**
 * Escape `_` and `#` inside `\text{...}` within math blocks. KaTeX rejects
 * unescaped `_` in text mode (even with `strict: false`), and upstream docs
 * routinely write things like `\text{block_size}`. We do this only inside
 * `$$...$$` and `$...$` regions so we don't touch unrelated prose.
 */
function escapeMathTextSpecials(src: string): string {
  const escapeText = (s: string): string =>
    s.replace(/\\text\{([^{}]*)\}/g, (_m, inner: string) => {
      const safe = inner.replace(/\\_/g, '_').replace(/_/g, '\\_').replace(/(?<!\\)#/g, '\\#');
      return `\\text{${safe}}`;
    });

  src = src.replace(/\$\$([\s\S]*?)\$\$/g, (_m, body: string) => `$$${escapeText(body)}$$`);
  src = src.replace(/(^|[^\\$])\$([^\n$]+?)\$/g, (_m, lead: string, body: string) =>
    `${lead}$${escapeText(body)}$`
  );
  return src;
}

function stripMkdocsAttributes(src: string, pageDir: string): string {
  src = src.replace(
    /!\[([^\]]*)\]\(([^)]+)\)\{([^}\n]+)\}/g,
    (_match, alt: string, url: string, attrs: string) => {
      const pairs: string[] = [];
      const re = /(\w[\w-]*)\s*=\s*"([^"]*)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(attrs)) !== null) {
        if (m[1] === 'align') continue; // mkdocs-only, not a real HTML attr
        pairs.push(`${m[1]}="${m[2]!.replace(/"/g, '&quot;')}"`);
      }
      const resolved = rewriteAssetUrl(pageDir, url);
      const attrStr = pairs.length > 0 ? ' ' + pairs.join(' ') : '';
      const altStr = alt.replace(/"/g, '&quot;');
      return `<img src="${resolved}" alt="${altStr}"${attrStr} />`;
    }
  );
  src = src.replace(/(\[[^\]]*\]\([^)]+\))\{[^}\n]*\}/g, '$1');
  src = src.replace(
    /<figure\b[^>]*\bmarkdown="(?:span|1|block)"[^>]*>([\s\S]*?)<\/figure>/g,
    (_match, inner: string) => `<figure>\n\n${inner.trim()}\n\n</figure>`
  );
  return src;
}

/**
 * Detect standalone lines that point at an example source file and replace
 * them with an inline collapsible card. The summary keeps the same card
 * look (icon + label + path + chevron); the body holds a fenced code block
 * with the file's source so readers can expand without leaving the page.
 *
 * Matched line shapes:
 *   Code example: [text](path-to-example)
 *   Full example: [text](path-to-example)
 *   - [text](path-to-example)
 *   - Multi-vector retrieval: [text](path-to-example)
 *   [text](path-to-example)
 *
 * The optional label-with-colon prefix is surfaced as the card title.
 * Lines where the link is mid-paragraph (text after the closing `)`) are
 * left untouched. Falls back to a link to the synthesized example page
 * when source isn't in the lookup (e.g. `.md` examples, or no bundle
 * context). Note: when a list item matches, the bullet marker is dropped
 * and CommonMark will split the surrounding list at the card — fine for
 * the common case of consecutive example links and acceptable for mixed
 * lists.
 */
const EXAMPLE_PATH_RE = /\/?examples\/(.+\.(py|sh|md|ipynb|yaml|yml|jinja))$/;
// Trailing punctuation (e.g. ". " at the end of a sentence-leading line) is
// permitted so prose like "...with Ray Serve LLM: [examples/...](...)."
// still gets recognized as the dominant content of the line. We also accept
// a trailing description after ` - `, ` — `, ` – `, or `: ` so bullets like
//   * [examples/foo.jinja](../foo.jinja) - this is the official template
// don't lose their accompanying caption when they become a card.
const EXAMPLE_LINE_RE =
  /^[ \t]*(?:(?:[-*+]|\d+\.)[ \t]+)?(?:([^[\n:]+?):[ \t]+)?\[([^\]]+)\]\(([^)\s]+)\)(?:[ \t]*[-–—:][ \t]+([^\n]+?))?[.,!?;]?[ \t]*$/gm;

const CARD_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
const CARD_ARROW_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';
const CARD_CHEVRON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

function emitExampleCard(
  url: string,
  examples: Record<string, ExampleSource>,
  title: string | undefined,
  description: string | undefined
): string | null {
  // Skip absolute URLs — these are pointers to external sources (e.g. the
  // synthesized example page's own "View source on GitHub" link, whose URL
  // happens to end in `examples/<file>.py` and would otherwise match.)
  if (/^https?:\/\//i.test(url)) return null;
  const m = url.match(EXAMPLE_PATH_RE);
  if (!m) return null;
  const tail = m[1]!;
  const ext = m[2]!.toLowerCase();
  const stemPath = tail.slice(0, -(ext.length + 1));
  const slug = `/examples/${stemPath}`;
  const sourceRel = `examples/${tail}`;
  const display = `examples/${tail}`;
  const titleLine = title
    ? `<span class="example-card-title">${escapeHtml(title)}</span>`
    : null;
  const descLine = description
    ? `<span class="example-card-desc">${escapeHtml(description)}</span>`
    : null;

  const ex = examples[sourceRel];
  // Markdown examples render rich content (not just a code dump) on
  // their own page; keep them as a link rather than inlining.
  if (!ex || ext === 'md') {
    return [
      '',
      `<a class="example-card" href="${slug}" data-kind="example">`,
      `<span class="example-card-icon" aria-hidden="true">${CARD_ICON_SVG}</span>`,
      '<span class="example-card-body">',
      '<span class="example-card-label">Code example</span>',
      ...(titleLine ? [titleLine] : []),
      `<span class="example-card-path">${display}</span>`,
      ...(descLine ? [descLine] : []),
      '</span>',
      `<span class="example-card-arrow" aria-hidden="true">${CARD_ARROW_SVG}</span>`,
      '</a>',
      ''
    ].join('\n');
  }

  const ghLine = ex.ghUrl ? `[View source on GitHub](${ex.ghUrl})` : '';
  return [
    '',
    '<details class="example-card example-card-details" data-kind="example">',
    '<summary class="example-card-summary">',
    `<span class="example-card-icon" aria-hidden="true">${CARD_ICON_SVG}</span>`,
    '<span class="example-card-body">',
    '<span class="example-card-label">Code example</span>',
    ...(titleLine ? [titleLine] : []),
    `<span class="example-card-path">${display}</span>`,
    ...(descLine ? [descLine] : []),
    '</span>',
    `<span class="example-card-arrow" aria-hidden="true">${CARD_CHEVRON_SVG}</span>`,
    '</summary>',
    '<div class="example-card-content">',
    '',
    '```' + (ex.lang || ext),
    ex.code,
    '```',
    '',
    ghLine,
    '',
    '</div>',
    '</details>',
    ''
  ].join('\n');
}

function rewriteCodeExampleLinks(
  src: string,
  examples: Record<string, ExampleSource>
): string {
  return src.replace(
    EXAMPLE_LINE_RE,
    (
      match,
      prefix: string | undefined,
      _label: string,
      url: string,
      trailing: string | undefined
    ) => {
      const title = prefix?.trim() || undefined;
      // Drop the redundant "Code example" / "Full example" labels — the
      // card itself already says "Code example".
      const cleanTitle =
        title && /^(?:code|full)\s+example$/i.test(title) ? undefined : title;
      // Trailing description (after ` - ` / ` — ` / `: `) keeps the bullet's
      // explanation visible on the card so converting to a card doesn't lose
      // the prose that previously sat inline.
      const desc = trailing?.trim() || undefined;
      const card = emitExampleCard(url, examples, cleanTitle, desc);
      return card ?? match;
    }
  );
}

/** Permissive second pass: catch lines that mention an `examples/<x>.ext`
 *  link embedded *in prose* on either side — e.g.
 *    "The [`foo.py`](path) script demonstrates how to extend …"
 *  The strict EXAMPLE_LINE_RE above requires the link to be the dominant
 *  content of the line (only sentence-trailing punctuation or a ` - desc`
 *  tail tolerated). This pass picks up the rest.
 *
 *  Risk control:
 *    - line-by-line with fenced-code tracking so we never reach into
 *      triple-backtick blocks.
 *    - skip headings / blockquotes / raw HTML lines.
 *    - skip lines the strict pass already converted (those start with
 *      `<details` / `<a class="example-card`).
 *    - emitExampleCard returns null for non-example URLs, so the URL
 *      still has to point at an examples/* path before anything changes.
 */
const PROSE_LINE_RE =
  /^([ \t]*(?:(?:[-*+]|\d+\.)[ \t]+)?)([^\n[]*?)\[([^\]]+)\]\(([^)\s]+)\)([^\n]*?)[ \t]*$/;

function rewriteProseExampleLinks(
  src: string,
  examples: Record<string, ExampleSource>
): string {
  const lines = src.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trimStart();
    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (
      trimmed === '' ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('>') ||
      trimmed.startsWith('<')
    ) {
      continue;
    }
    const m = line.match(PROSE_LINE_RE);
    if (!m) continue;
    const url = m[4]!;
    const leading = (m[2] ?? '').trim();
    const trailing = (m[5] ?? '').trim().replace(/^[-–—:,.\s]+/, '').trim();
    const desc = trailing || leading || undefined;
    const card = emitExampleCard(url, examples, undefined, desc);
    if (card) lines[i] = card;
  }
  return lines.join('\n');
}

export function preprocessMkdocsBlocks(
  src: string,
  pageDir = '',
  examples: Record<string, ExampleSource> = {},
  counter: TabCounter = { n: 0 }
): string {
  src = liftIndentedMathBlocks(src);
  src = escapeMathTextSpecials(src);
  src = rewriteCodeExampleLinks(src, examples);
  src = rewriteProseExampleLinks(src, examples);
  src = stripMkdocsAttributes(src, pageDir);
  const lines = src.split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === '[TOC]') {
      i++;
      continue;
    }

    const h = parseHeader(line);
    if (!h) {
      out.push(line);
      i++;
      continue;
    }

    if (h.prefix === '===') {
      // Collect a run of consecutive === tabs (blank lines allowed between).
      const tabs: { label: string; body: string[] }[] = [];
      let cursor = i;
      while (cursor < lines.length) {
        const hh = parseHeader(lines[cursor]!);
        if (!hh || hh.prefix !== '===') break;
        cursor++;
        const { body, next } = collectBody(lines, cursor);
        tabs.push({ label: hh.type, body });
        cursor = next;
        // Skip blanks, peek for next ===.
        let look = cursor;
        while (look < lines.length && isBlank(lines[look])) look++;
        const peek = look < lines.length ? parseHeader(lines[look]!) : null;
        if (peek && peek.prefix === '===') {
          cursor = look;
          continue;
        }
        break;
      }
      i = cursor;
      out.push(...renderTabs(tabs, pageDir, examples, counter));
      continue;
    }

    // !!! or ??? or ???+
    i++;
    const { body, next } = collectBody(lines, i);
    i = next;
    const inner = preprocessMkdocsBlocks(body.join('\n'), pageDir, examples, counter);

    if (h.prefix === '!!!') {
      out.push(...renderAdmonition(h.type, h.title, inner));
    } else {
      const open = h.prefix === '???+';
      out.push(...renderCollapsible(h.type, h.title, inner, open));
    }
  }

  return out.join('\n');
}

function renderTabs(
  tabs: { label: string; body: string[] }[],
  pageDir: string,
  examples: Record<string, ExampleSource>,
  counter: TabCounter
): string[] {
  if (tabs.length === 0) return [];
  const id = `tg${++counter.n}`;
  const out: string[] = [''];
  out.push(`<div class="tabs" data-tabs="${id}">`);
  for (let t = 0; t < tabs.length; t++) {
    const checked = t === 0 ? ' checked' : '';
    out.push(
      `<input type="radio" name="${id}" id="${id}-${t}" class="tab-input tab-input-${t}"${checked} aria-hidden="true" />`
    );
  }
  out.push('<div class="tab-list" role="tablist">');
  for (let t = 0; t < tabs.length; t++) {
    out.push(`<label for="${id}-${t}" role="tab">${escapeHtml(tabs[t]!.label)}</label>`);
  }
  out.push('</div>');
  for (let t = 0; t < tabs.length; t++) {
    out.push(`<div class="tab-panel tab-panel-${t}" role="tabpanel">`);
    out.push('');
    const inner = preprocessMkdocsBlocks(tabs[t]!.body.join('\n'), pageDir, examples, counter);
    out.push(inner);
    out.push('');
    out.push('</div>');
  }
  out.push('</div>');
  out.push('');
  return out;
}

function renderAdmonition(type: string, title: string | undefined, body: string): string[] {
  const labelText =
    title === undefined ? ADMON_LABEL[type] ?? capitalize(type) : title;
  const showTitle = title !== '';
  const cls = `callout callout-${type}`;
  const out: string[] = [''];
  out.push(`<div class="${cls}" data-kind="${escapeHtml(type)}">`);
  if (showTitle) {
    out.push(`<div class="callout-title">${escapeHtml(labelText)}</div>`);
  }
  out.push('<div class="callout-body">');
  out.push('');
  out.push(body);
  out.push('');
  out.push('</div>');
  out.push('</div>');
  out.push('');
  return out;
}

function renderCollapsible(
  type: string,
  title: string | undefined,
  body: string,
  open: boolean
): string[] {
  const labelText =
    title === undefined ? ADMON_LABEL[type] ?? capitalize(type) : title;
  const showTitle = title !== '';
  const cls = `collapsible collapsible-${type}`;
  const out: string[] = [''];
  out.push(`<details class="${cls}" data-kind="${escapeHtml(type)}"${open ? ' open' : ''}>`);
  if (showTitle) {
    out.push(`<summary class="collapsible-title">${escapeHtml(labelText)}</summary>`);
  }
  out.push('<div class="collapsible-body">');
  out.push('');
  out.push(body);
  out.push('');
  out.push('</div>');
  out.push('</details>');
  out.push('');
  return out;
}
