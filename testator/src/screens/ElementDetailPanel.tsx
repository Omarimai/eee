import { Text } from 'ink';
import { deriveConfidence, confidenceGlyph, confidenceLabel } from '../engine/confidence';
import { isFormField, type Row } from './elementExplorerRows';
import type { ElementRecord } from '../types';

interface Props {
  inspecting: boolean;
  highlightedRow: Row | undefined;
  highlighted: ElementRecord | undefined;
  note: string | undefined;
}

/**
 * The Explorer's right-hand panel — what's shown depends on what the
 * cursor is currently on: a deeper inspect view (full ranked selector list,
 * ancestor trail, validation flags) when `inspecting`, a summary for group/
 * cluster/"more" header rows, or the normal per-field detail card for an
 * actual element. Moving the cursor here only ever changes what's
 * *displayed* — it has no effect on what gets saved to the report.
 */
export function ElementDetailPanel({ inspecting, highlightedRow, highlighted, note }: Props) {
  if (inspecting && highlighted) {
    return (
      <>
        <Text bold wrap="truncate-end">
          Inspect: {highlighted.accessibleName || '(no accessible name)'}
        </Text>
        <Text dimColor wrap="truncate-end">
          Ancestor trail: {highlighted.cssPath.split(' > ').slice(0, -1).join(' › ') || '(root)'}
        </Text>
        <Text wrap="truncate-end">All ranked selectors:</Text>
        {highlighted.selectors.map((s, i) => (
          <Text key={i} wrap="truncate-end">
            {' '}
            - {s.type} {s.value} ({s.confidence})
          </Text>
        ))}
        <Text wrap="truncate-end">
          Validation: required={highlighted.required ? 'yes' : 'no'} readonly={highlighted.readonly ? 'yes' : 'no'}{' '}
          disabled={highlighted.disabled ? 'yes' : 'no'} multiple={highlighted.multiple ? 'yes' : 'no'}
        </Text>
        <Text dimColor>Esc/i close inspect · q back</Text>
      </>
    );
  }

  if (highlightedRow?.kind === 'group') {
    return (
      <>
        <Text bold wrap="truncate-end">
          {highlightedRow.name}
        </Text>
        <Text dimColor>
          {highlightedRow.count} elements — {highlightedRow.expanded ? 'Enter/← collapse' : 'Enter/→ expand'}
        </Text>
      </>
    );
  }

  if (highlightedRow?.kind === 'cluster') {
    return (
      <>
        <Text bold wrap="truncate-end">
          {highlightedRow.label}
        </Text>
        <Text dimColor>{highlightedRow.count} elements in this collection — Enter/→ expand · ← collapse</Text>
      </>
    );
  }

  if (highlightedRow?.kind === 'more') {
    return <Text dimColor>Press Enter or → to show all {highlightedRow.remaining} more</Text>;
  }

  if (!highlighted) {
    return <Text dimColor>No element selected</Text>;
  }

  return (
    <>
      <Text bold wrap="truncate-end">
        {highlighted.accessibleName || '(no accessible name)'}
      </Text>
      <Text wrap="truncate-end">
        Tag: {'<' + highlighted.tag + (highlighted.type ? ` type="${highlighted.type}"` : '') + '>'}
      </Text>
      {highlighted.groupContext && <Text wrap="truncate-end">Group: {highlighted.groupContext}</Text>}
      <Text>
        Visible: {highlighted.visible ? 'yes' : 'no'}  Disabled: {highlighted.disabled ? 'yes' : 'no'}  Required:{' '}
        {highlighted.required ? 'yes' : 'no'}
      </Text>
      <Text wrap="truncate-end">
        Selector: {highlighted.bestSelector.type}={highlighted.bestSelector.value} ({highlighted.bestSelector.confidence}{' '}
        confidence)
      </Text>
      {!highlighted.id && isFormField(highlighted) && <Text color="yellow">⚠ No id present</Text>}
      <Text wrap="truncate-end">Available actions: {highlighted.availableActions.join(' · ') || 'none'}</Text>
      <Text wrap="truncate-end">
        Inspection: {confidenceGlyph(deriveConfidence(highlighted))} {confidenceLabel(deriveConfidence(highlighted))}
      </Text>
      {note && <Text wrap="truncate-end">Note: {note}</Text>}
      <Text dimColor>[Enter] Execute action    [I] Inspect details    [N] Add note</Text>
    </>
  );
}
