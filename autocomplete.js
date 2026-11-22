import {Editor, Textcomplete, caretCoordinates} from './vendor/calculator/completion.mjs?v=a84a3c1c58c18aee';

export const autocompleteGroups = ['calculator', 'answer', 'other'];
const preferenceKey = 'graspmemoedu:autocomplete';
const sources = new WeakMap();
const token = /([a-z_][a-z_0-9]*|[+−*×/÷^!(),.π√=\-])$/i;
const wholeValue = /^(.+)$/s;
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function readPreferences() {
  try { return JSON.parse(localStorage.getItem(preferenceKey)) || {}; }
  catch { return {}; }
}

let preferences = readPreferences();
export const autocompleteEnabled = group => preferences[group] !== false;
export function setAutocompleteEnabled(group, enabled) {
  if (!autocompleteGroups.includes(group)) return;
  preferences = {...preferences, [group]: enabled};
  try { localStorage.setItem(preferenceKey, JSON.stringify(preferences)); }
  catch { /* Keep browser-local settings for this page when storage is unavailable. */ }
}

// Source items may be strings or {label, value, keys}. The provider is evaluated
// as the user types so live worksheet state can determine what is offered.
export function setInputCompletions(field, provider, {whole = false, match = token} = {}) {
  sources.set(field, {provider, whole, match: whole ? wholeValue : match});
}

export function installAutocomplete(defaultCandidates) {
  let field, group, source, queryValue, queryCursor, applying = false, navigated = false;
  class NativeFieldEditor extends Editor {
    getBeforeCursor() {
      return field.selectionStart === field.selectionEnd ? field.value.slice(0, field.selectionStart) : null;
    }

    getCursorOffset() {
      const bounds = field.getBoundingClientRect();
      const caret = caretCoordinates(field, field.selectionEnd);
      const lineHeight = parseFloat(getComputedStyle(field).lineHeight) || 20;
      const left = bounds.left + caret.left - field.scrollLeft;
      const top = bounds.top + caret.top - field.scrollTop;
      return {left: Math.max(1, Math.min(left, bounds.right)), top: top + lineHeight + 3, clientTop: top, lineHeight};
    }

    applySearchResult(result) {
      const before = this.getBeforeCursor();
      if (before === null) return;
      const match = result.getReplacementData(before);
      if (!match) return;
      const {value} = result.data;
      const after = field.value.slice(match.end);
      const tail = /^[a-z_]/i.test(before[match.start]) ? after.match(/^[a-z_0-9]*/i)[0] : '';
      const existingOpen = value.endsWith('(') && after[tail.length] === '(';
      const end = source?.whole ? field.value.length : match.end + tail.length + Number(existingOpen);
      if (field.maxLength >= 0 && field.value.length - (end - match.start) + value.length > field.maxLength) return;
      applying = true;
      try {
        field.setRangeText(value, match.start, end, 'end');
        field.dispatchEvent(new Event('input', {bubbles: true}));
      } finally { applying = false; }
    }
  }

  const editor = new NativeFieldEditor();
  const parent = document.createElement('div');
  const completion = new Textcomplete(editor, [{
    match: text => (source?.match || token).exec(text),
    search(term, receive) {
      const candidates = source ? source.provider() : defaultCandidates;
      const prefix = term.toLocaleLowerCase();
      receive(candidates.map(candidate => typeof candidate === 'string' ? {label: candidate, value: candidate} : candidate)
        .filter(({label, value, keys}) => (value !== term || field.selectionEnd !== field.value.length)
          && (keys || [value, label]).some(key => key.toLocaleLowerCase().startsWith(prefix))));
    },
    replace: () => '', // Textcomplete locates the replacement range; insert the literal candidate in the native field.
    template: candidate => escape(candidate.label),
  }], {dropdown: {parent, className: 'inputCompletions', maxCount: 8, rotate: true, style: {position: 'fixed'}}});

  const menu = parent.firstElementChild;
  menu.id = 'site-input-completions';
  menu.setAttribute('role', 'listbox');
  menu.addEventListener('mousedown', event => event.preventDefault());

  function updateActive() {
    const options = menu.querySelectorAll('.textcomplete-item');
    options.forEach((option, index) => {
      option.id = menu.id + '-' + index;
      option.setAttribute('role', 'option');
      const selected = option.classList.contains('active');
      option.setAttribute('aria-selected', String(selected));
      if (selected) field.setAttribute('aria-activedescendant', option.id);
    });
  }
  function fitMenu() {
    if (!completion.isShown()) return;
    const bounds = menu.getBoundingClientRect();
    const viewport = window.visualViewport;
    const right = Math.min(document.body.getBoundingClientRect().right,
      viewport ? viewport.offsetLeft + viewport.width : innerWidth) - 6;
    const bottom = (viewport ? viewport.offsetTop + viewport.height : innerHeight) - 6;
    if (bounds.right > right) menu.style.left = Math.max(6, right - bounds.width) + 'px';
    if (bounds.bottom > bottom) {
      menu.style.bottom = 'auto';
      menu.style.top = Math.max((viewport?.offsetTop || 0) + 6, editor.getCursorOffset().clientTop - bounds.height - 3) + 'px';
    }
  }
  const ariaAttributes = ['aria-autocomplete', 'aria-controls', 'aria-activedescendant'];
  let priorAria;
  completion.on('shown', () => {
    priorAria = ariaAttributes.map(name => field.getAttribute(name));
    field.setAttribute('aria-autocomplete', 'list');
    field.setAttribute('aria-controls', menu.id);
  }).on('rendered', () => {
    updateActive();
    fitMenu();
  }).on('hidden', () => {
    ariaAttributes.forEach((name, index) => {
      if (priorAria[index] === null) field.removeAttribute(name);
      else field.setAttribute(name, priorAria[index]);
    });
  });

  function dismiss() {
    completion.hide();
    field = null;
  }

  function input(event) {
    if (applying) return;
    const target = event.target;
    if (event.isComposing || document.activeElement !== target ||
        !target.matches('textarea, input:is([type="text"], [type="search"], [type="url"], [type="tel"], :not([type]))') ||
        target.matches(':disabled, [readonly]') || target.closest('[hidden], [inert], [data-autocomplete="off"]') ||
        target.selectionStart !== target.selectionEnd || target.selectionEnd === null) return dismiss();
    const scope = target.closest('[data-autocomplete]')?.dataset.autocomplete;
    const nextGroup = scope || (target.closest('.questionCalculator') ? 'calculator'
      : target.form?.matches('.answerForm, .atomicAnswerForm') ||
        target.closest('.questionInteraction, .passageBlankText, .hyperskillCodeEditor') ? 'answer' : 'other');
    if (!autocompleteEnabled(nextGroup)) return dismiss();
    if (target !== field) {
      dismiss();
      field = target;
      group = nextGroup;
      source = sources.get(target);
      (target.closest('dialog') || document.body).append(menu);
    }
    navigated = false;
    queryValue = field.value;
    queryCursor = field.selectionEnd;
    editor.emitChangeEvent();
  }

  document.addEventListener('input', input, true);
  document.addEventListener('compositionend', input, true);
  document.addEventListener('compositionstart', dismiss, true);
  document.addEventListener('focusout', event => { if (event.target === field) dismiss(); }, true);
  document.addEventListener('pointerdown', event => { if (!menu.contains(event.target)) dismiss(); }, true);
  document.addEventListener('scroll', event => { if (event.target !== menu && event.target !== field) dismiss(); }, true);
  window.addEventListener('hashchange', dismiss);
  window.addEventListener('resize', fitMenu);
  window.visualViewport?.addEventListener('resize', fitMenu);
  window.addEventListener('storage', event => {
    if (event.key === preferenceKey || event.key === null) {
      preferences = readPreferences();
      if (field && !autocompleteEnabled(group)) dismiss();
    }
  });
  document.addEventListener('keydown', event => {
    if (!field || event.target !== field || !completion.isShown()) return;
    if (field.value !== queryValue || field.selectionStart !== queryCursor || field.selectionEnd !== queryCursor ||
        !autocompleteEnabled(group) || event.isComposing) return dismiss();
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return dismiss();
    let handled;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      navigated = true;
      handled = editor.emitMoveEvent(event.key === 'ArrowUp' ? 'UP' : 'DOWN');
      updateActive();
    } else if (event.key === 'Tab' || event.key === 'Enter' && navigated) {
      handled = editor.emitEnterEvent();
    } else if (event.key === 'Escape') {
      handled = editor.emitEscEvent();
    } else if (['Enter', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
      dismiss();
    }
    if (handled?.defaultPrevented) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
}
