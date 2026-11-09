import { Text } from 'ink';
import { deriveConfidence, confidenceGlyph } from '../engine/confidence';
import { isFormField, type Row } from './elementExplorerRows';

interface Props {
  row: Row;
  isCurrent: boolean;
}

/**
 * Renders one row of the Explorer's left-hand list — a group header,
 * collection header, "...N more" leaf, or a single element. Deliberately a
 * single flat `<Text>` per row, never a nested `<Box>`: Ink doesn't reliably
 * reserve vertical space for a wrapped Text node in a tight flex column,
 * and a multi-line row can get the next one drawn on top of it. Forcing
 * single-line truncation (`wrap="truncate-end"`) sidesteps that bug class
 * entirely rather than guessing safe character counts.
 */
export function ElementRow({ row, isCurrent }: Props) {
  const prefix = isCurrent ? '❯ ' : '  ';
  const color = isCurrent ? 'cyan' : undefined;

  if (row.kind === 'group') {
    return (
      <Text color={color} wrap="truncate-end">
        {prefix}
        {row.expanded ? '▼' : '▶'} {row.name} ({row.count})
      </Text>
    );
  }

  if (row.kind === 'cluster') {
    return (
      <Text color={color} wrap="truncate-end">
        {prefix}  {row.expandState > 0 ? '▾' : '▸'} {row.label} ({row.count})
      </Text>
    );
  }

  if (row.kind === 'more') {
    return (
      <Text color={color} dimColor wrap="truncate-end">
        {prefix}  └─ ... {row.remaining} more
      </Text>
    );
  }

  const el = row.el;
  const glyph = confidenceGlyph(deriveConfidence(el));
  const name = el.accessibleName || el.id || el.name || `<${el.tag}>`;
  const typeLabel = el.tag + (el.type ? `:${el.type}` : '');
  const actionsLabel = el.availableActions.join('·') || 'none';
  return (
    <Text color={color} wrap="truncate-end">
      {prefix}
      {row.clusterKey ? '  ├─ ' : '  '}
      {glyph} {name}  {typeLabel}  {actionsLabel}
      {!el.id && isFormField(el) ? ' ⚠' : ''}
    </Text>
  );
}
