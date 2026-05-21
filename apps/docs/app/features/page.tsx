import { notFound } from 'next/navigation';
import { Wand2, Wrench, Layers, GraduationCap, ShieldCheck } from 'lucide-react';
import { DocsShell } from '@/components/layout/DocsShell';
import { LandingHero } from '@/components/landing/LandingHero';
import { LandingCardGrid, type LandingCard } from '@/components/landing/LandingCardGrid';
import { DocBody } from '@/components/layout/DocBody';
import { bundleExists, loadBundle } from '@/lib/content/loader';
import { loadContentMap } from '@/lib/content/overlay';
import { renderMarkdown } from '@/lib/markdown/pipeline';

export default async function FeaturesLanding() {
  if (!bundleExists()) notFound();
  const bundle = loadBundle();
  const contentMap = loadContentMap();

  // Embed the upstream features/README.md (compatibility matrix +
  // feature-x-hardware tables) below the curated card grids. It's
  // genuine reference content but doesn't merit its own sidebar entry.
  const readme = bundle.pages['features/README.md'];
  const readmeHtml = readme
    ? await renderMarkdown(readme.rawMarkdown, {
        ref: bundle.meta.vllmRef,
        refs: bundle.refs,
        pagePath: readme.path,
        validPaths: new Set(Object.keys(bundle.pages))
      })
    : null;

  const advanced: LandingCard[] = [
    {
      badge: 'VRAM',
      title: 'Quantization',
      description:
        'FP8 / INT8 / INT4 / AWQ / GPTQ / GGUF / MXFP4 / NVFP4 — drop precision to fit larger models on the same GPU.',
      href: '/features/quantization/fp8',
      meta: '15 pages',
      icon: <Wand2 className="size-4" />
    },
    {
      badge: 'Hooks',
      title: 'Advanced extensibility',
      description:
        'LoRA · custom args · custom logits processors · context extension · prompt embeds · interleaved thinking · sleep mode · batch invariance · prefix caching · disagg encoder.',
      href: '/features/lora',
      meta: '10 pages',
      icon: <Wrench className="size-4" />
    }
  ];

  const coverage: LandingCard[] = [
    {
      badge: 'Models',
      title: 'Model coverage',
      description:
        'Supported models matrix, generative vs pooling families, hardware compatibility, and registration extensions.',
      href: '/models/supported_models',
      meta: '15 pages',
      icon: <Layers className="size-4" />
    },
    {
      badge: 'Training',
      title: 'Training',
      description:
        'Async RL, RLHF, layer-wise tuning, routed-experts replay, TRL integration, weight transfer over IPC / NCCL, and the vllm-project/speculators companion library for training draft models.',
      href: '/training/rlhf',
      meta: '9 pages',
      icon: <GraduationCap className="size-4" />
    }
  ];

  const production: LandingCard[] = [
    {
      badge: 'Prod',
      title: 'Production hardening',
      description:
        'Security guidance, Prometheus metrics surface, reproducibility knobs, and what the usage-stats collector sends back.',
      href: '/usage/security',
      meta: '4 pages',
      icon: <ShieldCheck className="size-4" />
    }
  ];

  return (
    <DocsShell bundle={bundle} contentMap={contentMap} sectionId="features" hideToc>
      <LandingHero
        eyebrow="Advanced Features"
        title="Tune for your workload"
        description="The everyday features (multimodal, tool calling, structured outputs, reasoning) and the most-used performance toggles (speculative decoding, large-scale serving) live under Get started. The pages below cover the deeper levers most teams reach for once production traffic kicks in — quantization, extension hooks, and the model + training surface."
      />

      <LandingCardGrid
        heading="Performance & extensibility"
        cards={advanced}
        cols={2}
        featuredFirst
      />
      <LandingCardGrid heading="Model coverage" cards={coverage} cols={2} />
      <LandingCardGrid heading="Run in production" cards={production} cols={2} />

      {readmeHtml && (
        <section className="mt-14 border-t pt-10">
          <DocBody html={readmeHtml} />
        </section>
      )}
    </DocsShell>
  );
}
