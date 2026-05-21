import { DocsShell } from '@/components/layout/DocsShell';
import { PageHead } from '@/components/layout/PageHead';
import { DocBody } from '@/components/layout/DocBody';
import type { TemplateComponent } from './types';

const Guide: TemplateComponent = ({ page, bundle, contentMap, html }) => {
  const overlay = contentMap.pages[page.path] ?? {};
  return (
    <DocsShell bundle={bundle} contentMap={contentMap} page={page}>
      <PageHead
        eyebrow="Guide"
        page={page}
        overlay={overlay}
        extraMeta={overlay.task ? [overlay.task] : []}
      />
      <DocBody html={html} />
    </DocsShell>
  );
};

export default Guide;
