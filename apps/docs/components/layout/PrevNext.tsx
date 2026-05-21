import Link from 'next/link';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { Page } from '@vllm-docs/content-bundle';
import type { NavGroup } from '@/lib/content/sections';

interface PrevNextProps {
  groups: NavGroup[];
  current: Page;
}

export function PrevNext({ groups, current }: PrevNextProps) {
  const flat: Page[] = groups.flatMap((g) => g.pages);
  const idx = flat.findIndex((p) => p.path === current.path);
  if (idx === -1) return null;
  const prev = idx > 0 ? flat[idx - 1] : undefined;
  const next = idx < flat.length - 1 ? flat[idx + 1] : undefined;

  if (!prev && !next) return null;

  return (
    <nav className="mt-12 grid gap-3 sm:grid-cols-2 pt-6 border-t">
      {prev ? (
        <Link
          href={`/${prev.slug}`}
          className="group flex flex-col rounded-lg border p-4 hover:border-foreground/20 hover:bg-secondary/30 transition-colors"
        >
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <ArrowLeft className="size-3" /> Previous
          </span>
          <span className="mt-1 font-medium group-hover:text-foreground">
            {prev.title}
          </span>
        </Link>
      ) : (
        <div />
      )}
      {next ? (
        <Link
          href={`/${next.slug}`}
          className="group flex flex-col rounded-lg border p-4 hover:border-foreground/20 hover:bg-secondary/30 transition-colors text-right sm:text-right"
        >
          <span className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
            Next <ArrowRight className="size-3" />
          </span>
          <span className="mt-1 font-medium group-hover:text-foreground">
            {next.title}
          </span>
        </Link>
      ) : (
        <div />
      )}
    </nav>
  );
}
