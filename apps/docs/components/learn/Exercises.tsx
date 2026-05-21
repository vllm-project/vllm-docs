import { FlaskConical } from 'lucide-react';

interface ExercisesProps {
  exercises?: string[];
}

export function Exercises({ exercises }: ExercisesProps) {
  if (!exercises || exercises.length === 0) return null;
  return (
    <section className="mt-12 rounded-xl border bg-card p-5">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-semibold text-vllm-blue mb-3">
        <FlaskConical className="size-3.5" />
        Try this
      </div>
      <ol className="space-y-3 list-none counter-reset-exercise">
        {exercises.map((e, i) => (
          <li key={i} className="flex gap-3 text-[14.5px] leading-relaxed">
            <span
              aria-hidden
              className="shrink-0 inline-flex items-center justify-center size-6 rounded-full bg-vllm-blue/10 text-vllm-blue text-[12px] font-semibold mt-0.5"
            >
              {i + 1}
            </span>
            <span className="text-foreground/90 whitespace-pre-line">{e}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
