import { Container, Cloud, Network } from 'lucide-react';
import { DocsShell } from '@/components/layout/DocsShell';
import { PageHead } from '@/components/layout/PageHead';
import { DocBody } from '@/components/layout/DocBody';
import { LandingCardGrid, type LandingCard } from '@/components/landing/LandingCardGrid';
import type { TemplateComponent } from './types';

const Start: TemplateComponent = ({ page, bundle, contentMap, html }) => {
  const overlay = contentMap.pages[page.path] ?? {};
  const isQuickstart = page.path === 'getting_started/quickstart.md';

  const installPaths: LandingCard[] = [
    {
      badge: 'Container',
      title: 'Using Docker',
      description:
        'Official image, GPU passthrough, env tuning. The shortest path from "works on my laptop" to a real machine.',
      href: '/deployment/docker',
      icon: <Container className="size-4" />
    },
    {
      badge: 'Cluster',
      title: 'Using Kubernetes',
      description:
        'Helm chart, GPU nodepools, probes, autoscaling, and the LeaderWorkerSet pattern for multi-node inference.',
      href: '/deployment/k8s',
      icon: <Cloud className="size-4" />
    },
    {
      badge: 'Edge',
      title: 'Using Nginx',
      description:
        'Reverse-proxy patterns: TLS, sticky routing for KV-cache reuse, fan-out across replicas.',
      href: '/deployment/nginx',
      icon: <Network className="size-4" />
    }
  ];

  return (
    <DocsShell bundle={bundle} contentMap={contentMap} page={page}>
      <PageHead
        eyebrow="Get started"
        page={page}
        overlay={overlay}
        description="First-success path. Copy, run, validate."
      />
      <DocBody html={html} />
      {isQuickstart && (
        // In-flow signpost after the curl-success path. These three are
        // deployment shapes, not install alternatives — pip + `vllm
        // serve` is the install / dev loop; Docker / K8s / Nginx are
        // how teams actually ship to a real host.
        // The same three pages also appear in the Get started sidebar
        // under "Deploy" for global discovery; the in-flow card grid
        // here just shortens the path for a user reading Quickstart
        // top-to-bottom.
        <LandingCardGrid
          heading="Deploy it"
          subheading="`pip install vllm` + `vllm serve` is the dev path. Pick the deployment shape that fits your infra when you're ready to ship."
          cards={installPaths}
          cols={3}
        />
      )}
    </DocsShell>
  );
};

export default Start;
