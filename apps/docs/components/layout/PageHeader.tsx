import { cn } from '@/lib/utils';

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description?: string;
  /** Tiny metadata pills shown next to the eyebrow (e.g. task name). */
  meta?: string[];
  /** Difficulty tier 1-3, shown as filled/empty dots. */
  difficulty?: 1 | 2 | 3;
  className?: string;
}

const DIFFICULTY_LABEL: Record<1 | 2 | 3, string> = {
  1: 'Beginner',
  2: 'Intermediate',
  3: 'Advanced'
};

export function PageHeader({
  eyebrow,
  title,
  description,
  meta,
  difficulty,
  className
}: PageHeaderProps) {
  return (
    <header className={cn('mb-8', className)}>
      <div className="flex items-center gap-2 mb-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
        <span className="text-vllm-blue">{eyebrow}</span>
        {difficulty !== undefined && <span aria-hidden>·</span>}
        {difficulty !== undefined && (
          <span
            className="inline-flex items-center gap-1 normal-case tracking-normal text-[11px]"
            title={DIFFICULTY_LABEL[difficulty]}
          >
            <span aria-hidden className="font-mono tracking-tighter">
              {'●'.repeat(difficulty)}
              <span className="text-muted-foreground/30">
                {'●'.repeat(3 - difficulty)}
              </span>
            </span>
            <span className="sr-only">{DIFFICULTY_LABEL[difficulty]}</span>
          </span>
        )}
        {meta && meta.length > 0 && (
          <>
            <span aria-hidden>·</span>
            {meta.map((m, i) => (
              <span
                key={i}
                className="rounded-full border px-2 py-0.5 normal-case tracking-normal text-[11px]"
              >
                {m}
              </span>
            ))}
          </>
        )}
      </div>
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{title}</h1>
      {description && (
        <p className="mt-3 text-lg text-muted-foreground leading-relaxed">{description}</p>
      )}
    </header>
  );
}
