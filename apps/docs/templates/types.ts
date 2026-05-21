import type { ReactNode } from 'react';
import type { Bundle, ContentMap, Page } from '@vllm-docs/content-bundle';

export interface TemplateProps {
  page: Page;
  bundle: Bundle;
  contentMap: ContentMap;
  /** Pre-rendered HTML from the markdown pipeline. */
  html: string;
}

// React 19 dropped the global JSX namespace; use ReactNode for compatibility.
export type TemplateComponent = (props: TemplateProps) => ReactNode;
