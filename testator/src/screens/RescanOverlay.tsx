import { Box, Text } from 'ink';
import type { DiffResult, RescanSummary } from '../types';

interface Props {
  screen: string;
  summary: RescanSummary;
  diff: DiffResult;
}

/**
 * Full-screen replacement shown after a manual rescan (`r`) that found a
 * real change — see `ElementExplorer`'s `rescanWithDiff`. Never shown for
 * the silent auto-rescan that follows every fill/click, and never shown for
 * a rescan that just navigated to a different page (that's not a real
 * field-level diff — see `diffScansSafe`).
 */
export function RescanOverlay({ screen, summary, diff }: Props) {
  const shown = diff.changes.slice(0, 15);
  const more = diff.changes.length - shown.length;

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Text bold>RESCAN RESULTS · {screen}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text color="green">
          + {summary.added} new element{summary.added === 1 ? '' : 's'}
        </Text>
        <Text color="red">
          - {summary.removed} removed element{summary.removed === 1 ? '' : 's'}
        </Text>
        <Text color="yellow">
          ~ {summary.changed} modified element{summary.changed === 1 ? '' : 's'}
        </Text>
        <Text dimColor>
          = {summary.unchanged} unchanged element{summary.unchanged === 1 ? '' : 's'}
        </Text>
      </Box>
      {shown.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>CHANGES</Text>
          {shown.map((c, i) => {
            const prefix =
              c.type === 'added' ? '+ ' : c.type === 'removed' ? '- ' : c.type === 'low-confidence-match' ? '⚠ ' : '~ ';
            const color = c.type === 'added' ? 'green' : c.type === 'removed' ? 'red' : 'yellow';
            return (
              <Text key={i} color={color} wrap="truncate-end">
                {prefix}
                {c.label || c.message}
              </Text>
            );
          })}
          {more > 0 && <Text dimColor>...{more} more (see saved report)</Text>}
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>Esc/q close · s save report</Text>
      </Box>
    </Box>
  );
}
