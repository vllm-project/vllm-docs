'use client';

import * as React from 'react';
import { Laptop, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';

/** Three-state theme cycle: light → dark → system → light.
 *  Using a cycle keeps the icon-only button compact while still exposing
 *  the "follow system" option (which a binary light/dark toggle hides
 *  forever once the user clicks it once). */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  // Avoid SSR/hydration flash: render a placeholder until mounted.
  if (!mounted) {
    return <Button variant="ghost" size="icon" className="size-8" aria-label="Toggle theme" />;
  }

  const current = (theme ?? 'system') as 'light' | 'dark' | 'system';
  const next =
    current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light';
  const label =
    next === 'light'
      ? 'Switch to light theme'
      : next === 'dark'
        ? 'Switch to dark theme'
        : 'Follow system theme';
  const Icon = current === 'light' ? Sun : current === 'dark' ? Moon : Laptop;

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      onClick={() => setTheme(next)}
      title={label}
      aria-label={label}
    >
      <Icon className="size-4" />
    </Button>
  );
}
