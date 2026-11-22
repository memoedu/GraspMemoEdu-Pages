import {refreshCompletionSurface, setCompletionSurface, setInputCompletions} from './autocomplete.js?v=7f75039d97260881';
import {formulaSpans, formulaTemplates, formulaToken} from './formula-catalog.js?v=7f75039d97260881';
import {getLanguage} from './i18n.js?v=7f75039d97260881';
import previews from './vendor/formula/previews.mjs?v=7f75039d97260881';

const local = (zh, en) => getLanguage() === 'en' ? en : zh;
const style = 'formulaSourceHidden';
const active = new Set();
const hosts = new WeakMap();
let runtime, observer;
const choices = formulaTemplates.filter(item => previews[item.sample]).map(item => ({
  ...item, value: item.sample, preview: previews[item.sample],
}));

function candidates(query) {
  if (!query) return [];
  const lower = query.toLocaleLowerCase();
  return choices.filter(item => item.keys.some(key => key.toLocaleLowerCase().startsWith(lower))
    && item.latex !== query).slice(0, 8);
}

export function activeFormulaField(element) {
  const control = hosts.get(element?.closest?.('[data-formula-surface]'));
  return control?.anchor(element);
}

function load() {
  runtime ||= import('./vendor/formula/editor.mjs?v=7f75039d97260881').catch(error => { runtime = null; throw error; });
  return runtime;
}

export function attachFormulaEditing(input, {group = 'other', source = input, after = source, launch = true,
  onValue, sourceField, readSource} = {}) {
  if (input.readOnly) return null;
  const host = document.createElement('div');
  host.className = 'formulaInput';
  host.dataset.formulaSurface = '';
  host.hidden = true;
  after.after(host);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'textButton formulaInputButton';
  button.textContent = local('插入公式', 'Insert formula');
  if (launch) host.before(button);

  const enabled = () => !(input.disabled || input.readOnly || source === input && input.hidden);
  let editor, pending, disposed = false, sending = false, attributeObserver, detachSource;
  button.disabled = !enabled();
  const controller = {
    anchor(element) {
      if (!editor || host.hidden || !enabled()) return null;
      return {field: input, insert: editor.anchor(element)};
    },
    get visible() { return !!editor && !host.hidden; },
    selection: () => controller.visible ? editor.sourceSelection() : null,
    focusAt: (offset, end) => editor?.focusSource(offset, end),
    sync() {
      button.disabled = !enabled();
      if (source === input) button.hidden = input.hidden;
      if (!editor || sending) return;
      editor.setDisabled();
      editor.replaceSource(input.value);
      if (input.required) editor.root.setAttribute('aria-required', 'true');
      else editor.root.removeAttribute('aria-required');
      host.hidden = source === input && input.hidden;
    },
    destroy() {
      disposed = true;
      active.delete(controller);
      attributeObserver?.disconnect();
      detachSource?.();
      editor?.destroy();
      source.classList.remove(style);
      host.remove();
      button.remove();
    },
    async insertFormula(latex, sourceSelection) {
      const selection = source === input && !controller.visible ? [input.selectionStart, input.selectionEnd] : sourceSelection;
      const value = input.value;
      const surface = await open();
      if (!surface || value !== input.value) return;
      if (selection && selection[0] !== null) surface.insertAt(...selection, latex);
      else surface.insertFormula(latex);
    },
  };
  hosts.set(host, controller);
  controller.connected = () => input.isConnected;

  function reflect(value) {
    if (input.value === value) return;
    sending = true;
    try {
      input.value = value;
      onValue?.(value);
      input.dispatchEvent(new Event('input', {bubbles: true}));
    } finally { sending = false; }
  }

  function forwardSubmit(event) {
    if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter' || event.isComposing || event.defaultPrevented) return;
    if (!input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', ctrlKey: event.ctrlKey, metaKey: event.metaKey, cancelable: true, bubbles: true,
    }))) event.preventDefault();
  }

  async function open() {
    if (disposed || !enabled()) return null;
    if (editor) return editor;
    if (pending) return pending;
    pending = (async () => {
      try {
        const {createFormulaEditor} = await load();
        if (disposed || !input.isConnected || !enabled()) return null;
        const label = input.labels?.[0]?.textContent || input.getAttribute('aria-label') || local('公式与文字', 'Formulas and text');
        const surface = await createFormulaEditor(host, {
          label, value: () => input.value, enabled, maxLength: () => input.maxLength < 0 ? Infinity : input.maxLength,
          change: reflect, submit: forwardSubmit, candidates, register: (element, read) => setCompletionSurface(element, group, read),
          refresh: refreshCompletionSurface, formula: local('公式', 'Formula'),
          fraction: local('改为分式', 'Set as a fraction'), operator: local('修正运算符排版', 'Format the operator'),
        });
        if (disposed || !input.isConnected || !enabled()) { surface.destroy(); return null; }
        editor = surface;
        editor.replaceSource(input.value);
        if (input.getAttribute('aria-describedby')) editor.root.setAttribute('aria-describedby', input.getAttribute('aria-describedby'));
        if (input.required) editor.root.setAttribute('aria-required', 'true');
        editor.root.addEventListener('keydown', forwardSubmit);
        source.classList.add(style);
        host.hidden = false;
        return editor;
      } catch {
        // Dismiss the enhancement on an asset failure and retain the native draft.
        return null;
      } finally { pending = null; }
    })();
    return pending;
  }

  async function showTypedFormula() {
    if (!input.isConnected || !enabled() || sending) return;
    if (editor) { controller.sync(); return; }
    if (!formulaSpans(input.value).length) return;
    const focused = source === input ? document.activeElement === input : source.contains(document.activeElement);
    const offset = source === input ? input.selectionEnd : input.value.length;
    const oldFocus = document.activeElement;
    const surface = await open();
    if (focused && surface && (document.activeElement === oldFocus || document.activeElement === document.body))
      surface.focus(offset);
  }

  button.addEventListener('pointerdown', event => event.preventDefault());
  button.addEventListener('click', () => { void controller.insertFormula(); });
  attributeObserver = new MutationObserver(() => controller.sync());
  attributeObserver.observe(input, {attributes: true, attributeFilter: ['disabled', 'readonly', 'hidden']});
  if (sourceField) detachSource = setCompletionSurface(sourceField, group, () => {
    if (controller.visible || !enabled()) return null;
    const state = readSource();
    if (!state || state.from !== state.to) return null;
    const query = state.value.slice(0, state.from).match(formulaToken)?.[0];
    if (!query) return null;
    const suffix = /^[\\a-z_]/i.test(query) ? state.value.slice(state.to).match(/^[a-z_0-9]*/i)[0].length : 0;
    return {...state, candidates: candidates(query), apply(candidate) {
      if (state.current()) void controller.insertFormula(candidate.latex, [state.from - query.length, state.to + suffix]);
    }};
  });
  // Keep native form events, draft persistence, and existing shortcuts intact.
  if (source === input) {
    setInputCompletions(input, () => choices, {match: formulaToken, apply(candidate, from, to) {
      const pinned = input.value;
      const cursor = input.selectionEnd;
      void open().then(surface => {
        if (surface && input.value === pinned && input.selectionStart === cursor && input.selectionEnd === cursor
          && input.isConnected && enabled()) surface.insertAt(from, to, candidate.latex);
      });
      return true;
    }});
    input.addEventListener('paste', event => {
      const raw = event.clipboardData?.getData('text/plain');
      const text = raw?.trim();
      if (!text || !/^\\[a-zA-Z]+/.test(text) || /[\r\n]/.test(text)) return;
      event.preventDefault();
      const from = input.selectionStart, to = input.selectionEnd, pinned = input.value;
      const paste = part => {
        if (input.value !== pinned || input.selectionStart !== from || input.selectionEnd !== to || !input.isConnected) return;
        const available = input.maxLength < 0 ? part.length : input.maxLength - pinned.length + to - from;
        input.setRangeText(part.slice(0, Math.max(0, available)), from, to, 'end');
        input.dispatchEvent(new Event('input', {bubbles: true}));
      };
      void load().then(({isLatexFragment}) => paste(isLatexFragment(text) ? '\\(' + text + '\\)' : raw), () => paste(raw));
    });
  }
  input.addEventListener('input', () => { void showTypedFormula(); });
  queueMicrotask(() => {
    if (input.isConnected) {
      active.add(controller);
      observer ||= new MutationObserver(() => {
        for (const item of active) if (!item.connected()) item.destroy();
      });
      observer.observe(document.body, {subtree: true, childList: true});
      void showTypedFormula();
    }
  });
  return controller;
}
