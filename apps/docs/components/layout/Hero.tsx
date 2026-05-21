import type { HeroMedia } from '@vllm-docs/content-bundle';

interface HeroProps {
  hero?: HeroMedia;
  /** Doc-relative path of the page being rendered, used to resolve relative
   *  image URLs the same way the markdown pipeline does. */
  pagePath: string;
}

const ASSETS_PREFIX = 'assets/';
const PUBLIC_MOUNT = '/_vllm-assets/';

function resolveSrc(pageDir: string, src: string): string {
  if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) return src;
  if (src.startsWith(PUBLIC_MOUNT)) return src;
  if (src.startsWith('/')) {
    return src.startsWith('/assets/') ? PUBLIC_MOUNT + src.slice('/assets/'.length) : src;
  }
  // Relative — same logic as remarkAssetPaths but standalone (no remark here).
  const segments: string[] = [];
  for (const seg of `${pageDir}/${src}`.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') segments.pop();
    else segments.push(seg);
  }
  const resolved = segments.join('/');
  if (resolved.startsWith(ASSETS_PREFIX)) {
    return PUBLIC_MOUNT + resolved.slice(ASSETS_PREFIX.length);
  }
  return src;
}

function pageDirFromPath(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

export function Hero({ hero, pagePath }: HeroProps) {
  if (!hero) return null;
  const pageDir = pageDirFromPath(pagePath);
  const aspectStyle = hero.aspect ? { aspectRatio: hero.aspect.replace('/', ' / ') } : undefined;

  let media: React.ReactNode = null;
  if (hero.type === 'image' || hero.type === 'svg') {
    const src = resolveSrc(pageDir, hero.src);
    media = (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={hero.alt ?? ''}
        loading="lazy"
        className="block w-full h-auto bg-muted/40"
      />
    );
  } else if (hero.type === 'video') {
    const src = resolveSrc(pageDir, hero.src);
    media = (
      <video
        src={src}
        autoPlay
        loop
        muted
        playsInline
        controls
        className="block w-full h-auto bg-muted/40"
      />
    );
  } else if (hero.type === 'youtube') {
    media = (
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${hero.src}`}
        title={hero.alt ?? 'Embedded video'}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="block w-full h-full border-0"
      />
    );
  }

  return (
    // Hero infographics are designed at viewBox ~960×{340..440} with
    // ~10.5–14px text inside. At <sm viewports (e.g. 360px wide) that
    // becomes ~4px — unreadable. Pin a min-width on the inner wrapper
    // so the SVG renders at near-design size and the figure becomes
    // horizontally scrollable instead of an illegible thumbnail.
    <figure className="mb-8 rounded-xl border overflow-x-auto sm:overflow-hidden bg-card">
      <div className="min-w-[720px] sm:min-w-0">
        <div style={aspectStyle}>{media}</div>
        {hero.caption && (
          <figcaption className="px-4 py-2.5 text-[12.5px] text-muted-foreground border-t bg-muted/30">
            {hero.caption}
          </figcaption>
        )}
      </div>
    </figure>
  );
}
