import { Sparkles } from 'lucide-react';

interface TLDRCardProps {
  summary?: string;
}

export function TLDRCard({ summary }: TLDRCardProps) {
  if (!summary) return null;
  return (
    <aside className="mb-8 rounded-xl border bg-vllm-blue/5 border-vllm-blue/20 p-5">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold text-vllm-blue mb-2">
        <Sparkles className="size-3.5" />
        TL;DR
      </div>
      <p className="text-[14.5px] leading-relaxed text-foreground/90">{summary}</p>
    </aside>
  );
}
