import { Box, Text, useInput } from 'ink';
import type { TreeNode } from '../engine/tree';

/**
 * Read-only view of `app.tsx`'s `tree` state (built by `engine/tree.ts`) —
 * the whole session's navigation map as an ASCII tree, newest branches
 * last. Unrelated to `exploration.ts`'s per-element event log; this tree is
 * keyed by arbitrary label paths (menu choices, workspace/screen names),
 * not elements, and spans every screen visited this session, not just one.
 */
interface Props {
  tree: TreeNode;
  onBack: () => void;
}

function renderLines(node: TreeNode, prefix: string, isLast: boolean): string[] {
  const lines: string[] = [];
  lines.push(prefix + (isLast ? '└─ ' : '├─ ') + node.label);
  const childPrefix = prefix + (isLast ? '   ' : '│  ');
  node.children.forEach((child, i) => {
    lines.push(...renderLines(child, childPrefix, i === node.children.length - 1));
  });
  return lines;
}

export function ExplorationTreeView({ tree, onBack }: Props) {
  useInput((input, key) => {
    if (key.escape || input === 'q') onBack();
  });

  const lines = tree.children.flatMap((child, i) => renderLines(child, '', i === tree.children.length - 1));
  // Every back-and-explore-something-else adds a sibling rather than
  // replacing anything, so this is the full session map, not just the
  // current path — can get long. Keep the most recent branches on screen
  // rather than scrolling the whole terminal.
  const visible = lines.slice(-40);

  return (
    <Box flexDirection="column" flexGrow={1} padding={1}>
      <Text bold>Exploration tree — this session</Text>
      <Box marginTop={1} flexDirection="column">
        {visible.length === 0 && <Text dimColor>Nothing explored yet.</Text>}
        {visible.map((line, i) => (
          <Text key={i} wrap="truncate-end">
            {line}
          </Text>
        ))}
        {lines.length > visible.length && (
          <Text dimColor>… {lines.length - visible.length} earlier line(s) not shown</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Esc/q back</Text>
      </Box>
    </Box>
  );
}
