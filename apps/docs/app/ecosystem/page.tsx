import { notFound } from 'next/navigation';
import { Bot, Cloud, Cog, Boxes, Sparkles, Code, Bird } from 'lucide-react';
import { DocsShell } from '@/components/layout/DocsShell';
import { LandingHero } from '@/components/landing/LandingHero';
import { LandingCardGrid, type LandingCard } from '@/components/landing/LandingCardGrid';
import { bundleExists, loadBundle } from '@/lib/content/loader';
import { loadContentMap } from '@/lib/content/overlay';

export default function EcosystemLanding() {
  if (!bundleExists()) notFound();
  const bundle = loadBundle();
  const contentMap = loadContentMap();

  const aiAgents: LandingCard[] = [
    {
      badge: 'CLI',
      title: 'Claude Code',
      description:
        "Use a local vLLM server as Claude Code's backend — same OAuth + plan flow, your weights and your latency.",
      href: '/serving/integrations/claude_code',
      icon: <Sparkles className="size-4" />
    },
    {
      badge: 'CLI',
      title: 'Codex',
      description:
        'Wire vLLM into the OpenAI Codex CLI with a one-line base_url override. Works with any model that supports tool calling.',
      href: '/serving/integrations/codex',
      icon: <Code className="size-4" />
    },
    {
      badge: 'CLI',
      title: 'OpenClaw',
      description:
        'Treat vLLM as a local OpenAI-compatible provider with streamed usage accounting — point OpenClaw at the server URL and you can route any model through it.',
      href: '/serving/integrations/openclaw',
      icon: <Bird className="size-4" />
    }
  ];

  const buckets: LandingCard[] = [
    {
      badge: '11 integrations',
      title: 'Agent frameworks & apps',
      description:
        'Plug vLLM into the LLM-app layer: LangChain, LlamaIndex, AutoGen, Dify, Haystack, LobeChat, Open WebUI, Streamlit, RAG.',
      href: '/serving/integrations/langchain',
      icon: <Bot className="size-4" />
    },
    {
      badge: '7 platforms',
      title: 'Cloud platforms',
      description:
        'Modal · RunPod · Cerebrium · Anyscale · Hugging Face Inference · SkyPilot · dstack — managed GPU compute, no YAML.',
      href: '/deployment/frameworks/modal',
      icon: <Cloud className="size-4" />
    },
    {
      badge: '5 components',
      title: 'Serving infra',
      description:
        'BentoML · Helm · LiteLLM · LeaderWorkerSet · Triton — building blocks for productionizing vLLM.',
      href: '/deployment/frameworks/bentoml',
      icon: <Cog className="size-4" />
    },
    {
      badge: '11 operators',
      title: 'Kubernetes operators',
      description:
        'AIBrix · Dynamo · KServe · KubeRay · llm-d · Production Stack — K8s-native runtimes that wrap vLLM.',
      href: '/deployment/integrations/kserve',
      icon: <Boxes className="size-4" />
    }
  ];

  return (
    <DocsShell bundle={bundle} contentMap={contentMap} sectionId="ecosystem" hideToc>
      <LandingHero
        eyebrow="Ecosystem"
        title="Where vLLM plugs in"
        description="vLLM is the engine, not the whole stack. The integrations below let you wire it into the LLM-app layer, run it on managed cloud platforms, or wrap it in Kubernetes-native runtimes — pick the layer that fits your team."
      />

      <LandingCardGrid
        heading="AI Agents"
        subheading="Already running vLLM? Point an AI agent at it in under a minute."
        cards={aiAgents}
        cols={3}
      />

      <LandingCardGrid
        heading="Browse by integration type"
        subheading="Self-managed deployment (Docker / k8s / nginx) lives under Get started."
        cards={buckets}
        cols={2}
      />
    </DocsShell>
  );
}
