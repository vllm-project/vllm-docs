import { notFound } from 'next/navigation';
import {
  Boxes,
  Database,
  Workflow,
  Layers,
  Plug,
  Image as ImageIcon,
  Activity
} from 'lucide-react';
import { DocsShell } from '@/components/layout/DocsShell';
import { LandingHero } from '@/components/landing/LandingHero';
import { LandingCardGrid, type LandingCard } from '@/components/landing/LandingCardGrid';
import { bundleExists, loadBundle } from '@/lib/content/loader';
import { loadContentMap } from '@/lib/content/overlay';

/** Hand-crafted Internals landing. Without it, the "Internals" tab would
 *  deep-link to whichever `design/*` page is alphabetically first, which
 *  is a poor first impression of what the section actually contains.
 *  One tile per Internals sub-area, each pointing at that area's
 *  canonical entry. Tile order matches the sidebar groupings. */
export default function InternalsLanding() {
  if (!bundleExists()) notFound();
  const bundle = loadBundle();
  const contentMap = loadContentMap();

  const cards: LandingCard[] = [
    {
      badge: 'Arch',
      title: 'Architecture',
      description:
        'The big picture: engine components, the V2 model runner, the multiprocessing layout, and vLLM’s internal IR. End with the V1 transition notes once you know what changed.',
      href: '/design/arch_overview',
      meta: '5 pages',
      icon: <Boxes className="size-4" />
    },
    {
      badge: 'Memory',
      title: 'Attention & KV-cache',
      description:
        'Paged attention, pluggable attention backends, prefix caching, and the hybrid KV-cache manager that ties them together.',
      href: '/design/paged_attention',
      meta: '4 pages',
      icon: <Database className="size-4" />
    },
    {
      badge: 'Compile',
      title: 'Compilation & graphs',
      description:
        'Optimization levels, `torch.compile` integration, CUDA graphs, fusion passes, custom ops, and how to debug a misbehaving compile.',
      href: '/design/optimization_levels',
      meta: '8 pages',
      icon: <Workflow className="size-4" />
    },
    {
      badge: 'Kernels',
      title: 'MoE & kernels',
      description:
        'Mixture-of-experts kernel features, the fused-MoE modular kernel, and DBO — how the heaviest ops are scheduled and executed.',
      href: '/design/moe_kernel_features',
      meta: '3 pages',
      icon: <Layers className="size-4" />
    },
    {
      badge: 'Extend',
      title: 'Plugins & extensions',
      description:
        'The plugin system, HuggingFace integration, I/O processor plugins, logits processors, LoRA resolvers, and the P2P NCCL connector.',
      href: '/design/plugin_system',
      meta: '6 pages',
      icon: <Plug className="size-4" />
    },
    {
      badge: 'MM',
      title: 'Multi-modal',
      description:
        'How vLLM processes multi-modal inputs end to end — image / audio / video handling on the runtime path.',
      href: '/design/mm_processing',
      meta: '1 page',
      icon: <ImageIcon className="size-4" />
    },
    {
      badge: 'Obs',
      title: 'Observability',
      description:
        'The metrics surface — what counters and histograms vLLM exposes, where they live, and how they’re wired into Prometheus.',
      href: '/design/metrics',
      meta: '1 page',
      icon: <Activity className="size-4" />
    }
  ];

  return (
    <DocsShell bundle={bundle} contentMap={contentMap} sectionId="concepts" hideToc>
      <LandingHero
        eyebrow="Internals"
        title="Under the hood"
        description="Design docs for the parts of vLLM most users never need to read — runtime architecture, KV-cache mechanics, compilation pipeline, kernel design, plugin surface. Useful when you're debugging a hot path, contributing a new backend, or just curious how it all fits together."
      />

      <LandingCardGrid cards={cards} cols={2} />
    </DocsShell>
  );
}
