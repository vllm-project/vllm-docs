'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import MiniSearch from 'minisearch';
import { Search, FileText, ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

interface IndexedDoc {
  id: string;
  title: string;
  slug: string;
  section: string;
  excerpt: string;
  body: string;
}

interface SearchPayload {
  docs: IndexedDoc[];
}

export function SearchModal({ open, onOpenChange }: SearchModalProps) {
  const [payload, setPayload] = React.useState<SearchPayload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');

  // Lazy-load the search index the first time the modal opens.
  React.useEffect(() => {
    if (!open || payload) return;
    let abort = false;
    fetch('/search-latest.json')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: SearchPayload) => {
        if (!abort) setPayload(data);
      })
      .catch((e) => {
        if (!abort) setError(String(e));
      });
    return () => {
      abort = true;
    };
  }, [open, payload]);

  const index = React.useMemo(() => {
    if (!payload) return null;
    const ms = new MiniSearch<IndexedDoc>({
      fields: ['title', 'body'],
      storeFields: ['title', 'slug', 'section', 'excerpt'],
      searchOptions: {
        boost: { title: 3 },
        prefix: true,
        fuzzy: 0.2
      }
    });
    ms.addAll(payload.docs);
    return ms;
  }, [payload]);

  const results = React.useMemo(() => {
    if (!index || query.trim().length < 2) return [];
    return index.search(query).slice(0, 25);
  }, [index, query]);

  React.useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[15vh] z-50 w-[640px] max-w-[92vw] -translate-x-1/2 rounded-xl border bg-background shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <DialogPrimitive.Title className="sr-only">Search documentation</DialogPrimitive.Title>
          <div className="flex items-center gap-2 px-4 py-3 border-b">
            <Search className="size-4 text-muted-foreground" />
            <input
              autoFocus
              type="text"
              placeholder="Search docs…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent outline-none text-[15px] placeholder:text-muted-foreground"
            />
            <kbd className="hidden sm:inline-flex h-5 select-none items-center rounded border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
              esc
            </kbd>
          </div>

          <div className="max-h-[60vh] overflow-y-auto scrollbar-thin">
            {!payload && !error && (
              <div className="flex items-center justify-center gap-2 p-8 text-muted-foreground text-sm">
                <Loader2 className="size-4 animate-spin" />
                Loading index…
              </div>
            )}
            {error && (
              <div className="p-8 text-center text-sm text-destructive">
                Failed to load search index: {error}
              </div>
            )}
            {payload && query.trim().length < 2 && (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Type at least 2 characters to search.
              </div>
            )}
            {payload && query.trim().length >= 2 && results.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No matches.
              </div>
            )}
            {results.length > 0 && (
              <ul className="py-2">
                {results.map((r) => (
                  <li key={r.id}>
                    <a
                      href={`/${r.slug}`}
                      className={cn(
                        'group flex items-start gap-3 px-4 py-2.5 hover:bg-secondary/60 transition-colors'
                      )}
                    >
                      <FileText className="size-4 mt-0.5 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-[14px] truncate">{r.title}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          <span className="capitalize">{r.section}</span> · {r.excerpt}
                        </div>
                      </div>
                      <ArrowRight className="size-3.5 mt-1 text-muted-foreground opacity-0 group-hover:opacity-100" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
