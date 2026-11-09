import type { ElementRecord } from '../types';

export type SemanticCategory = 'Navigation' | 'Search & filters' | 'Data & records' | 'Actions' | 'Forms' | 'Other';

export const SEMANTIC_CATEGORY_ORDER: SemanticCategory[] = [
  'Navigation',
  'Search & filters',
  'Data & records',
  'Actions',
  'Forms',
  'Other',
];

const FILL_LIKE_ACTIONS = ['fill', 'selectOption', 'selectOptions', 'check', 'uncheck', 'toggle', 'setValue', 'setInputFiles'];
const CLICK_LIKE_ACTIONS = ['click', 'activate'];
const SEARCHY = /search|filter|query|^q$/i;

function searchySelf(el: ElementRecord): boolean {
  return SEARCHY.test(el.accessibleName || el.id || el.name || '');
}

// Reuses the existing formId grouping signal rather than inventing a new
// ancestor capture — an unlabeled "Go" button next to a labeled "Search"
// field should still read as searchy because of its form-mates.
function isSearchy(el: ElementRecord, formMates: ElementRecord[]): boolean {
  if (searchySelf(el)) return true;
  return formMates.some(mate => mate !== el && searchySelf(mate));
}

// Best-effort heuristic, not guaranteed-correct — the Search-vs-Forms and
// Search-vs-Actions splits depend on keyword matching over labels/ids/names,
// so anything that doesn't say "search"/"filter"/"query"/"q" anywhere in its
// own name or its form-mates' names will fall through to the more generic
// bucket (Forms / Actions) rather than Search & filters. Only applies to
// elements with groupContext === null — the caller filters to that bucket;
// DOM-based grouping always wins when it exists.
export function categorizeUngrouped(
  elements: ElementRecord[],
  collectionMemberIndices: Set<number>
): Map<number, SemanticCategory> {
  const byForm = new Map<string, ElementRecord[]>();
  for (const el of elements) {
    if (!el.formId) continue;
    if (!byForm.has(el.formId)) byForm.set(el.formId, []);
    byForm.get(el.formId)!.push(el);
  }

  const result = new Map<number, SemanticCategory>();
  for (const el of elements) {
    if (el.tag === 'a' || ['tab', 'menuitem', 'menu', 'navigation', 'link'].includes(el.role || '')) {
      result.set(el.index, 'Navigation');
      continue;
    }
    if (collectionMemberIndices.has(el.index)) {
      result.set(el.index, 'Data & records');
      continue;
    }
    const formMates = el.formId ? byForm.get(el.formId) || [] : [];
    if (FILL_LIKE_ACTIONS.some(a => el.availableActions.includes(a))) {
      result.set(el.index, isSearchy(el, formMates) ? 'Search & filters' : 'Forms');
      continue;
    }
    if (CLICK_LIKE_ACTIONS.some(a => el.availableActions.includes(a))) {
      result.set(el.index, isSearchy(el, formMates) ? 'Search & filters' : 'Actions');
      continue;
    }
    result.set(el.index, 'Other');
  }
  return result;
}
