/**
 * Decides what a scanned DOM element can actually be made to do.
 *
 * A pure tag/type/role → action-list lookup table (fill, click, selectOption,
 * check, activate, ...). No DOM access, no side effects — `scan.ts` calls
 * this once per element right after reading its raw attributes, and the
 * result (`availableActions`) is what `interact.ts` later dispatches on to
 * decide HOW to act on an element the user chose.
 */
export function getAvailableActions(
  tag: string,
  type: string | null,
  draggable: boolean,
  contentEditable: boolean,
  multiple: boolean,
  disabled: boolean,
  readonly: boolean,
  isCustomInteractive = false
): string[] {
  if (disabled) return [];

  const t = tag.toLowerCase();
  let actions: string[] = [];

  if (t === 'textarea' || contentEditable) {
    actions = ['fill', 'clear', 'focus'];
  } else if (t === 'select') {
    actions = multiple ? ['selectOptions'] : ['selectOption'];
  } else if (t === 'input') {
    switch ((type || 'text').toLowerCase()) {
      case 'checkbox':
        actions = ['check', 'uncheck', 'toggle'];
        break;
      case 'radio':
        actions = ['check'];
        break;
      case 'range':
        actions = ['setValue'];
        break;
      case 'file':
        actions = ['setInputFiles'];
        break;
      case 'hidden':
        actions = [];
        break;
      case 'submit':
      case 'button':
        actions = ['click'];
        break;
      default:
        actions = ['fill', 'clear', 'focus'];
    }
  } else if (t === 'button' || t === 'a' || t === 'summary') {
    actions = ['click'];
  } else if (draggable) {
    actions = ['dragTo'];
  } else if (isCustomInteractive) {
    actions = ['activate'];
  } else {
    actions = ['click'];
  }

  if (readonly) {
    actions = actions.filter(a => a === 'focus' || a === 'click' || a === 'activate');
  }

  return actions;
}
