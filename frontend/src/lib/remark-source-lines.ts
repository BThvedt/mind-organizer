import { visit } from 'unist-util-visit';
import type { Root } from 'mdast';

/**
 * Remark plugin that stamps a `data-source-line` attribute on every mdast
 * node that has source position info. The attribute is injected via
 * `hProperties`, which remark-rehype automatically copies to the rendered
 * HTML element, making each block/inline element queryable by its original
 * markdown line number.
 */
export function remarkSourceLines() {
  return (tree: Root) => {
    visit(tree, (node) => {
      if (!node.position?.start.line) return;
      const n = node as {
        data?: { hProperties?: Record<string, unknown> };
        position?: { start: { line: number } };
      };
      n.data ??= {};
      n.data.hProperties ??= {};
      n.data.hProperties['data-source-line'] = node.position.start.line;
    });
  };
}
