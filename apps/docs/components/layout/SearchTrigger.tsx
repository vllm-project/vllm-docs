'use client';

import * as React from 'react';
import { Search } from 'lucide-react';
import { SearchModal } from './SearchModal';

export function SearchTrigger() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      {/* Full search bar — sm+. Wide enough for label + ⌘K hint. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search docs"
        className="hidden sm:flex h-9 w-full items-center gap-2.5 rounded-lg border border-input bg-background pl-3 pr-2 text-[13px] text-muted-foreground shadow-sm hover:border-vllm-blue/40 hover:bg-secondary/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vllm-blue/30 transition-colors"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search docs…</span>
        <kbd className="hidden md:inline-flex h-5 select-none items-center rounded border bg-muted px-1.5 font-mono text-[10px]">
          ⌘K
        </kbd>
      </button>
      {/* Compact icon-only trigger — mobile (<sm). Opens the same modal so
          phone users have a search affordance without consuming header width. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search docs"
        className="sm:hidden inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vllm-blue/30 transition-colors"
      >
        <Search className="size-4" />
      </button>
      <SearchModal open={open} onOpenChange={setOpen} />
    </>
  );
}
