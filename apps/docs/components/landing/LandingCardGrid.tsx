import Link from 'next/link';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface LandingCard {
  title: string;
  description?: string;
  href: string;
  /** Tag pill in the top-left (e.g. category, audience). */
  badge?: string;
  /** Inline meta line at bottom (e.g. "5 min · Beginner"). */
  meta?: string;
  /** Open in a new tab and use ↗ icon. */
  external?: boolean;
  /** Optional small icon shown in the top-right. */
  icon?: ReactNode;
}

interface LandingCardGridProps {
  /** Section title above the grid. */
  heading?: string;
  /** Optional one-line subtitle below heading. */
  subheading?: string;
  cards: LandingCard[];
  cols?: 2 | 3 | 4;
  /** Highlight the first card visually as the recommended path. */
  featuredFirst?: boolean;
}

export function LandingCardGrid({
  heading,
  subheading,
  cards,
  cols = 3,
  featuredFirst
}: LandingCardGridProps) {
  if (cards.length === 0) return null;
  const colClass =
    cols === 4
      ? 'sm:grid-cols-2 lg:grid-cols-4'
      : cols === 2
      ? 'sm:grid-cols-2'
      : 'sm:grid-cols-2 lg:grid-cols-3';

  return (
    <section className="mb-12">
      {heading && (
        <h2 className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-3">
          {heading}
        </h2>
      )}
      {subheading && <p className="-mt-2 mb-4 text-sm text-muted-foreground">{subheading}</p>}
      <div className={cn('grid gap-3', colClass)}>
        {cards.map((c, i) => (
          <CardLink key={c.href} card={c} featured={featuredFirst && i === 0} />
        ))}
      </div>
    </section>
  );
}

function CardLink({ card, featured }: { card: LandingCard; featured?: boolean }) {
  const cls = cn(
    'group relative flex flex-col rounded-xl border bg-card p-5 transition-colors',
    featured
      ? 'border-vllm-blue/40 bg-vllm-blue/5 hover:border-vllm-blue/70'
      : 'hover:border-foreground/25 hover:bg-secondary/40'
  );

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {card.badge && (
            <div className="text-[10.5px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">
              {card.badge}
            </div>
          )}
          <div className="font-semibold text-[15px] leading-tight">{card.title}</div>
        </div>
        {card.icon && <div className="shrink-0 text-muted-foreground">{card.icon}</div>}
        {!card.icon && (card.external
          ? <ArrowUpRight className="size-4 text-muted-foreground/60 group-hover:text-foreground shrink-0 mt-0.5" />
          : <ArrowRight className="size-4 text-muted-foreground/60 group-hover:text-foreground group-hover:translate-x-0.5 transition-transform shrink-0 mt-0.5" />)}
      </div>
      {card.description && (
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
          {card.description}
        </p>
      )}
      {card.meta && (
        <div className="mt-3 text-[11.5px] text-muted-foreground/80">{card.meta}</div>
      )}
    </>
  );

  if (card.external) {
    return (
      <a href={card.href} target="_blank" rel="noopener" className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <Link href={card.href} className={cls}>
      {inner}
    </Link>
  );
}
