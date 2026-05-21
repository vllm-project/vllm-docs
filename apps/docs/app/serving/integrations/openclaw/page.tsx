import { notFound } from 'next/navigation';
import { ArrowUpRight } from 'lucide-react';
import { DocsShell } from '@/components/layout/DocsShell';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { bundleExists, loadBundle } from '@/lib/content/loader';
import { loadContentMap } from '@/lib/content/overlay';

export const metadata = {
  title: 'OpenClaw — vLLM docs'
};

export default function OpenClawPage() {
  if (!bundleExists()) notFound();
  const bundle = loadBundle();
  const contentMap = loadContentMap();

  return (
    <DocsShell bundle={bundle} contentMap={contentMap} sectionId="ecosystem">
      <PageHeader
        eyebrow="AI Agent"
        title="OpenClaw"
        description="A CLI coding agent that talks to any OpenAI-compatible provider. Point it at a local vLLM server and you get tool-calling, streamed usage accounting, and your own weights — without leaving the terminal."
      />

      <video
        src="https://fcma2ctad64a8hun.public.blob.vercel-storage.com/openclaw-demo.mov"
        controls
        muted
        playsInline
        preload="metadata"
        className="my-6 w-full rounded-xl border bg-muted/30 shadow-sm"
      />

      <div className="doc-body mt-8">
        <h2>How it fits</h2>
        <p>
          vLLM exposes an OpenAI-compatible HTTP server (chat completions, completions,
          embeddings, tool-calling). OpenClaw treats that server like any other provider in
          its config — once the URL and a model name are wired in, every command in the
          agent flows through your local engine.
        </p>
        <p>
          The integration adds <strong>streamed usage accounting</strong> on top of the
          OpenAI API: token counts arrive as part of the SSE stream rather than at the end,
          so OpenClaw can show live cost / token totals as the response generates.
        </p>

        <h2>Quick wire-up</h2>
        <p>
          Start a vLLM server, then point OpenClaw at it. The provider config typically
          looks like:
        </p>
        <pre><code>{`# OpenClaw provider config
name: vllm-local
type: openai
base_url: http://127.0.0.1:8000/v1
model: meta-llama/Llama-3.1-8B-Instruct
api_key: dummy   # vLLM doesn't require auth by default
`}</code></pre>

        <p>
          See the upstream docs for the full schema (additional providers, model aliases,
          tool definitions, secret management).
        </p>
      </div>

      <div className="my-8 flex flex-wrap gap-3">
        <a
          href="https://docs.openclaw.ai/providers/vllm"
          target="_blank"
          rel="noopener"
        >
          <Button>
            Open OpenClaw provider docs
            <ArrowUpRight className="size-4" />
          </Button>
        </a>
      </div>
    </DocsShell>
  );
}
