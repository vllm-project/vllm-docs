/**
 * Drop the leading H1 from the markdown AST.
 *
 * Every doc page renders its title via PageHead. Upstream markdown
 * conventionally starts with `# Title` (which we use to set page.title at
 * extract time). Without stripping, the page shows two h1s back-to-back —
 * one in the header chrome, one in the body.
 *
 * Only the first heading is removed, and only if it's depth=1. If the
 * markdown doesn't start with an h1 (rare), nothing changes.
 */
export function remarkStripFirstH1() {
  return (tree: any) => {
    const children: any[] = tree?.children ?? [];
    for (let i = 0; i < children.length; i++) {
      const n = children[i];
      // Skip leading "definition"/empty/yaml-like nodes.
      if (!n) continue;
      if (n.type === 'yaml' || n.type === 'toml' || n.type === 'definition') continue;
      if (n.type === 'heading' && n.depth === 1) {
        children.splice(i, 1);
      }
      // Stop after first non-skip node, regardless of whether it was h1.
      break;
    }
  };
}
