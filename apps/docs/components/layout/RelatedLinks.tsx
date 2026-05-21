import Link from 'next/link';
import { ArrowUpRight, BookOpen, Brain, ChefHat, Gauge } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Bundle, PageOverlay } from '@vllm-docs/content-bundle';

interface RelatedLinksProps {
  bundle: Bundle;
  overlay: PageOverlay;
}

interface Item {
  href: string;
  title: string;
  external?: boolean;
}

interface Category {
  id: string;
  label: string;
  icon: ReactNode;
  items: Item[];
}

function buildCategories(bundle: Bundle, overlay: PageOverlay): Category[] {
  const out: Category[] = [];

  const guides = (overlay.related_guides ?? [])
    .map((p) => bundle.pages[p])
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p): Item => ({ href: `/${p.slug}`, title: p.title }));
  if (guides.length) {
    out.push({ id: 'guides', label: 'Guides', icon: <BookOpen className="size-3.5" />, items: guides });
  }

  const concepts = (overlay.related_concepts ?? [])
    .map((p) => bundle.pages[p])
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p): Item => ({ href: `/${p.slug}`, title: p.title }));
  if (concepts.length) {
    out.push({ id: 'concepts', label: 'Concepts', icon: <Brain className="size-3.5" />, items: concepts });
  }

  const recipes = (overlay.related_recipes ?? []).map(
    (id): Item => ({
      href: `https://docs.vllm.ai/projects/recipes/en/latest/${id}`,
      title: id,
      external: true
    })
  );
  if (recipes.length) {
    out.push({ id: 'recipes', label: 'Recipes', icon: <ChefHat className="size-3.5" />, items: recipes });
  }

  const benchmarks = (overlay.related_benchmarks ?? []).map(
    (id): Item => ({
      href: `https://docs.vllm.ai/projects/recipes/en/latest/benchmarking/${id}`,
      title: id,
      external: true
    })
  );
  if (benchmarks.length) {
    out.push({ id: 'benchmarks', label: 'Benchmarks', icon: <Gauge className="size-3.5" />, items: benchmarks });
  }

  return out;
}

export function RelatedLinks({ bundle, overlay }: RelatedLinksProps) {
  const categories = buildCategories(bundle, overlay);
  if (categories.length === 0) return null;

  return (
    <section className="mt-10">
      <div className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-3">
        Related
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {categories.flatMap((cat) =>
          cat.items.map((item) => (
            <RelatedCard
              key={`${cat.id}:${item.href}`}
              category={cat}
              item={item}
            />
          ))
        )}
      </div>
    </section>
  );
}

function RelatedCard({ category, item }: { category: Category; item: Item }) {
  const inner = (
    <>
      <div className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider font-medium text-muted-foreground">
        {category.icon}
        {category.label}
      </div>
      <div className="mt-1.5 font-medium text-[14px] leading-snug truncate">
        {item.title}
      </div>
    </>
  );
  const className =
    'group block rounded-lg border bg-card p-3.5 transition-colors hover:border-foreground/25 hover:bg-secondary/40 relative';

  if (item.external) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener"
        className={className}
      >
        {inner}
        <ArrowUpRight className="size-3.5 absolute top-3 right-3 text-muted-foreground/60 group-hover:text-foreground" />
      </a>
    );
  }
  return (
    <Link href={item.href} className={className}>
      {inner}
    </Link>
  );
}
