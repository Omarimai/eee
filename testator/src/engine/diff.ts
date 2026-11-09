import type { ScreenScan, DiffResult, DiffChange, ElementRecord, RescanSummary } from '../types';

export function diffScans(oldScan: ScreenScan, newScan: ScreenScan): DiffResult {
  const changes: DiffChange[] = [];
  const oldByFingerprint = new Map(oldScan.elements.map(e => [e.fingerprint, e]));
  const matchedOld = new Set<string>();

  for (const ne of newScan.elements) {
    const oe = oldByFingerprint.get(ne.fingerprint);
    if (oe) {
      matchedOld.add(oe.fingerprint);
      const attrDiffs: string[] = [];
      if (oe.type !== ne.type) attrDiffs.push(`type ${oe.type ?? 'none'} → ${ne.type ?? 'none'}`);
      if (oe.disabled !== ne.disabled) attrDiffs.push(`disabled ${oe.disabled} → ${ne.disabled}`);
      if (oe.required !== ne.required) attrDiffs.push(`required ${oe.required} → ${ne.required}`);
      if (oe.readonly !== ne.readonly) attrDiffs.push(`readonly ${oe.readonly} → ${ne.readonly}`);
      if (attrDiffs.length) {
        changes.push({ type: 'changed', message: `"${describe(ne)}" — ${attrDiffs.join(', ')}`, label: describe(ne) });
      }
      continue;
    }

    const candidate = oldScan.elements.find(
      oe2 =>
        !matchedOld.has(oe2.fingerprint) &&
        oe2.accessibleName &&
        ne.accessibleName &&
        oe2.accessibleName === ne.accessibleName &&
        oe2.groupContext === ne.groupContext
    );

    if (candidate) {
      matchedOld.add(candidate.fingerprint);
      const notes: string[] = [];
      if (candidate.id && !ne.id) notes.push(`previously had id="${candidate.id}", now none`);
      if (candidate.name && !ne.name) notes.push(`previously had name="${candidate.name}", now none`);
      if (candidate.dataTestId && !ne.dataTestId)
        notes.push(`previously had data-testid="${candidate.dataTestId}", now none`);
      changes.push({
        type: 'low-confidence-match',
        message: `"${describe(ne)}" matched by label+position only.${
          notes.length ? ' ' + notes.join('; ') + '.' : ''
        } Verify manually.`,
        label: describe(ne),
      });
      continue;
    }

    changes.push({ type: 'added', message: `"${describe(ne)}" is new.`, label: describe(ne) });
  }

  for (const oe of oldScan.elements) {
    if (!matchedOld.has(oe.fingerprint)) {
      changes.push({ type: 'removed', message: `"${describe(oe)}" is no longer present.`, label: describe(oe) });
    }
  }

  return { previousScanAt: oldScan.scannedAt, changes };
}

function describe(el: ElementRecord): string {
  return el.accessibleName || el.id || el.name || `<${el.tag}>`;
}

// A "screen" in this app is rooted at a URL prefix, not a single exact URL —
// /admin/users and /admin/users/u-1001 are the same screen (a list and one
// of its own detail records), while /admin/something-else is a different
// one. Fingerprint-diffing across a navigation WITHIN the same screen (list
// -> detail, or back again) compares two genuinely different pages' worth
// of DOM, so every field on the old page reads as "removed" and every field
// on the new one as "added" — technically true, but it drowns out anything
// actually worth flagging and reads like data loss when nothing was lost;
// what happened is already captured as an action in the session trail. Only
// run the real field-by-field diff when the URL didn't change.
export function diffScansSafe(oldScan: ScreenScan, newScan: ScreenScan): DiffResult {
  if (oldScan.url !== newScan.url) {
    return {
      previousScanAt: oldScan.scannedAt,
      changes: [
        {
          type: 'navigated',
          message: `Navigated from ${oldScan.url} to ${newScan.url} — different page within this screen, so the field-by-field diff is skipped here (see "ACTIONS THIS SESSION" for what happened).`,
        },
      ],
    };
  }
  return diffScans(oldScan, newScan);
}

// Derives the +added/-removed/~changed/=unchanged counts for the rescan
// overlay from a DiffResult that's already been computed — diffScans itself
// needs no changes, unchanged elements just never produced a DiffChange so
// the count is always a subtraction.
export function summarizeRescan(diff: DiffResult, newElementCount: number): RescanSummary {
  const added = diff.changes.filter(c => c.type === 'added').length;
  const removed = diff.changes.filter(c => c.type === 'removed').length;
  const changed = diff.changes.filter(c => c.type === 'changed' || c.type === 'low-confidence-match').length;
  const unchanged = newElementCount - added - changed;
  return { added, removed, changed, unchanged };
}
