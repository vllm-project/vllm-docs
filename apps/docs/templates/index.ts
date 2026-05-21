import type { TemplateName } from '@vllm-docs/content-bundle';
import type { TemplateComponent } from './types';
import Guide from './guide';
import Start from './start';
import Reference from './reference';
import Concept from './concept';
import Contribute from './contribute';
import Intro from './intro';

export const templates: Record<TemplateName, TemplateComponent> = {
  guide: Guide,
  start: Start,
  reference: Reference,
  concept: Concept,
  contribute: Contribute,
  intro: Intro
};
