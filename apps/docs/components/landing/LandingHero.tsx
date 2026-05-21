import type { ReactNode } from 'react';

interface LandingHeroProps {
  eyebrow: string;
  title: string;
  description: string;
  /** Optional CTA below the description (Link or button). */
  cta?: ReactNode;
  /** Optional decoration on the right side (illustration, kpi, etc.). */
  aside?: ReactNode;
}

export function LandingHero({ eyebrow, title, description, cta, aside }: LandingHeroProps) {
  return (
    <section className="mb-10 grid gap-6 sm:grid-cols-[1fr_auto] sm:items-end">
      <div>
        <div className="text-[11px] uppercase tracking-wider font-medium text-vllm-blue mb-3">
          {eyebrow}
        </div>
        <h1 className="text-3xl md:text-[40px] leading-[1.1] font-bold tracking-tight">
          {title}
        </h1>
        <p className="mt-4 text-lg text-muted-foreground leading-relaxed max-w-prose">
          {description}
        </p>
        {cta && <div className="mt-6">{cta}</div>}
      </div>
      {aside && <div className="shrink-0">{aside}</div>}
    </section>
  );
}
