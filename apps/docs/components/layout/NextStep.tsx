import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { Bundle, PageOverlay } from '@vllm-docs/content-bundle';

interface NextStepProps {
  bundle: Bundle;
  overlay: PageOverlay;
}

export function NextStep({ bundle, overlay }: NextStepProps) {
  const steps = overlay.next_steps ?? [];
  const resolved = steps
    .map((p) => bundle.pages[p])
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  if (resolved.length === 0) return null;

  return (
    <section className="mt-12">
      <div className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground mb-3">
        Next step
      </div>
      <div className="space-y-2">
        {resolved.map((p) => (
          <Link
            key={p.path}
            href={`/${p.slug}`}
            className="group flex items-center justify-between gap-4 rounded-xl border bg-card p-5 transition-colors hover:border-vllm-blue/40 hover:bg-vllm-blue/5"
          >
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">Continue with</div>
              <div className="mt-0.5 font-semibold text-[15px] truncate">
                {p.title}
              </div>
            </div>
            <ArrowRight className="size-4 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-vllm-blue" />
          </Link>
        ))}
      </div>
    </section>
  );
}
