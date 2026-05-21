import Link from 'next/link';
import { Rocket, Wrench, Code, Lightbulb } from 'lucide-react';
import { DocsShell } from '@/components/layout/DocsShell';
import { PageHead } from '@/components/layout/PageHead';
import { DocBody } from '@/components/layout/DocBody';
import {
  LandingCardGrid,
  type LandingCard
} from '@/components/landing/LandingCardGrid';
import type { TemplateComponent } from './types';

const Intro: TemplateComponent = ({ page, bundle, contentMap, html }) => {
  const overlay = contentMap.pages[page.path] ?? {};

  const audiences: LandingCard[] = [
    {
      badge: 'Run a model',
      title: 'Quickstart',
      description: 'Install vLLM and serve an open-source LLM in five minutes — Python or HTTP.',
      href: '/getting_started/quickstart',
      meta: 'Beginner · 6 min',
      icon: <Rocket className="size-4" />
    },
    {
      badge: 'Build apps',
      title: 'OpenAI-compatible server',
      description: 'Same SDKs, same routes, vLLM throughput underneath. Drop-in replacement for the OpenAI API.',
      href: '/serving/openai_compatible_server',
      meta: 'Beginner · 11 min',
      icon: <Wrench className="size-4" />
    },
    {
      badge: 'Contribute',
      title: 'Developer guide',
      description: 'Build vLLM from source, add a model, write a kernel, ship a release.',
      href: '/contributing/incremental_build',
      icon: <Code className="size-4" />
    }
  ];

  return (
    <DocsShell bundle={bundle} contentMap={contentMap} page={page}>
      <PageHead eyebrow="Documentation" page={page} overlay={overlay} />

      <DocBody html={html} />

      <LandingCardGrid
        heading="Where to start"
        subheading="Pick the path that matches what you're building."
        cards={audiences}
        cols={3}
      />

      <p className="mt-10 text-sm text-muted-foreground inline-flex items-center gap-1.5">
        <Lightbulb className="size-3.5" />
        Stuck on installation or first run? See the{' '}
        <Link href="/usage/faq" className="text-vllm-blue hover:underline">
          FAQ
        </Link>
        {' '}or{' '}
        <Link href="/usage/troubleshooting" className="text-vllm-blue hover:underline">
          troubleshooting guide
        </Link>
        .
      </p>
    </DocsShell>
  );
};

export default Intro;
