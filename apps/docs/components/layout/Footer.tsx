import { Github } from 'lucide-react';

const RESOURCE_LINKS: { label: string; href: string }[] = [
  { label: 'Home', href: 'https://vllm.ai' },
  { label: 'Blog', href: 'https://vllm.ai/blog' },
  { label: 'Recipes', href: 'https://recipes.vllm.ai' },
  { label: 'Slack', href: 'https://slack.vllm.ai' }
];

export function Footer() {
  return (
    <footer className="mt-16 border-t bg-background">
      <div className="mx-auto max-w-[1440px] px-4 md:px-6 py-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] text-muted-foreground">
          © 2026 vLLM <span aria-hidden className="mx-1.5 text-muted-foreground/60">·</span> All rights reserved.
        </p>
        <nav aria-label="Project resources" className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {RESOURCE_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noopener"
              className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {l.label}
            </a>
          ))}
          <a
            href="https://github.com/vllm-project/vllm"
            target="_blank"
            rel="noopener"
            aria-label="GitHub"
            className="text-muted-foreground hover:text-foreground transition-colors inline-flex items-center"
          >
            <Github className="size-4" />
          </a>
        </nav>
      </div>
    </footer>
  );
}
