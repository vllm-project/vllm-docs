import { notFound } from 'next/navigation';
import { Terminal, Sliders, Cpu, Gauge } from 'lucide-react';
import { DocsShell } from '@/components/layout/DocsShell';
import { LandingHero } from '@/components/landing/LandingHero';
import { LandingCardGrid, type LandingCard } from '@/components/landing/LandingCardGrid';
import { bundleExists, loadBundle } from '@/lib/content/loader';
import { loadContentMap } from '@/lib/content/overlay';

/** Hand-crafted Reference landing — without this, the "Reference" top tab
 *  would deep-link to whichever page is alphabetically first
 *  (`benchmarking/cli`), which makes for a confusing first impression of
 *  what Reference actually contains. Five tiles, one per Reference
 *  sub-area, each pointing at that area's canonical entry. */
export default function ReferenceLanding() {
  if (!bundleExists()) notFound();
  const bundle = loadBundle();
  const contentMap = loadContentMap();

  // Ordered by lookup frequency:
  //   Configuration   — every server start re-checks an arg or env var
  //   CLI             — how to invoke; checked once per command
  //   Model support   — pre-deployment compatibility check
  //   Benchmarking    — specialized perf work
  //
  // FAQ + Troubleshooting are narrative rescue content, not look-up
  // tables — they live under Get started → Help, not here.
  const cards: LandingCard[] = [
    {
      badge: 'Config',
      title: 'Configuration',
      description:
        'Engine arguments, environment variables, the model-resolution policy, and how to point `vllm serve` at a config file instead of typing flags.',
      href: '/configuration',
      meta: '5 pages',
      icon: <Sliders className="size-4" />
    },
    {
      badge: 'CLI',
      title: 'Command-line interface',
      description:
        '`vllm serve`, `vllm chat`, `vllm complete`, `vllm run-batch` — every top-level command, its flags, and what it does. Plus benchmark subcommands under `vllm bench`.',
      href: '/cli/serve',
      meta: '5 pages',
      icon: <Terminal className="size-4" />
    },
    {
      badge: 'Models',
      title: 'Model support',
      description:
        'Which model architectures vLLM knows about, plus per-platform notes for CPU and Intel XPU backends. Pure compatibility tables — usage guides live under Advanced Features.',
      href: '/models/supported_models',
      meta: '3 pages',
      icon: <Cpu className="size-4" />
    },
    {
      badge: 'Bench',
      title: 'Benchmarking',
      description:
        'The `vllm bench` CLI suite, dataset / workload definitions, configuration sweeps, and how to wire results into a Grafana dashboard.',
      href: '/benchmarking',
      meta: '4 pages',
      icon: <Gauge className="size-4" />
    }
  ];

  return (
    <DocsShell bundle={bundle} contentMap={contentMap} sectionId="reference" hideToc>
      <LandingHero
        eyebrow="Reference"
        title="Look it up"
        description="Auto-generated arg / config / CLI dumps plus the compatibility tables that say what's supported where. If you're learning a feature for the first time, start under Get started or Advanced Features — this section is for when you already know what you're looking for."
      />

      <LandingCardGrid cards={cards} cols={2} />
    </DocsShell>
  );
}
