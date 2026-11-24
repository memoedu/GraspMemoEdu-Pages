import {getLanguage} from './i18n.js?v=783abd1bfadc97a5';
import {formulaAtPoint, formulaAt, formulaSelector, mathSource} from './clipper-selection.js?v=783abd1bfadc97a5';
import {mathSpans} from './math-syntax.js?v=783abd1bfadc97a5';

const interactive = 'math-field,input,textarea,select,[contenteditable="true"],[inert],[hidden]';
const elementOf = node => node?.nodeType === 1 ? node : node?.parentElement;
const tr = (zh, en) => getLanguage() === 'en' ? en : zh;

function formulaLatex(node) {
  const source = mathSource(node).trim();
  for (const span of mathSpans(source, {allowUnbalanced: true})) {
    if (span.from === 0 && span.to === source.length) return span.latex;
  }
  return source;
}

function makeButton() {
  const button = document.createElement('button');
  button.type = 'button';
  return button;
}

const keyCommands = {
  ArrowLeft: ['moveToPreviousChar', 'extendSelectionBackward'],
  ArrowRight: ['moveToNextChar', 'extendSelectionForward'],
};

export function installFormulaSelection({canExcerpt, excerpt} = {}) {
  const tools = document.createElement('div');
  tools.className = 'formulaSelectionTools';
  const trigger = makeButton();
  trigger.className = 'formulaSelectionTrigger';
  trigger.hidden = true;
  trigger.setAttribute('aria-controls', 'formulaSelectionPanel');
  trigger.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('div');
  panel.className = 'formulaSelectionPanel';
  panel.id = 'formulaSelectionPanel';
  panel.setAttribute('role', 'group');
  panel.hidden = true;
  const surface = document.createElement('div');
  surface.className = 'formulaSelectionSurface';
  const footer = document.createElement('div');
  footer.className = 'formulaSelectionFooter';
  const copy = makeButton(), save = makeButton(), close = makeButton();
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  footer.append(copy, save, close, status);
  panel.append(surface, footer);
  tools.append(trigger, panel);
  document.body.append(tools);
  let anchor, field, latex, hoverTimeout, attempt = 0;

  function selectable(node) {
    if (elementOf(node)?.closest(interactive)) return;
    const candidate = formulaAt(node);
    if (candidate && !candidate.closest(interactive) && candidate.getClientRects().length) return candidate;
  }

  function position() {
    if (!anchor?.isConnected || !anchor.getClientRects().length) {
      dismiss();
      return;
    }
    const rect = anchor.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= innerHeight) { dismiss(); return; }
    if (panel.hidden && trigger.hidden) return;
    const control = panel.hidden ? trigger : panel;
    const margin = 8;
    const left = Math.max(margin, Math.min(rect.left, innerWidth - control.offsetWidth - margin));
    const above = rect.top - control.offsetHeight - 4;
    const below = rect.bottom + 4;
    const preferAbove = control === trigger ? above >= margin : below + control.offsetHeight > innerHeight - margin;
    const top = Math.max(margin, Math.min(preferAbove ? above : below, innerHeight - control.offsetHeight - margin));
    Object.assign(control.style, {left: left + 'px', top: top + 'px'});
  }

  function attach(candidate) {
    if (!candidate || !panel.hidden && anchor !== candidate) return;
    clearTimeout(hoverTimeout);
    anchor = candidate;
    const root = anchor.closest('dialog[open],[popover]') || document.body;
    if (tools.parentElement !== root) root.append(tools);
    trigger.textContent = tr('选取公式片段', 'Select formula fragment');
    trigger.hidden = !panel.hidden;
    position();
  }

  function dismiss(restore = false) {
    const wasOpen = !panel.hidden;
    ++attempt;
    clearTimeout(hoverTimeout);
    panel.hidden = true;
    surface.replaceChildren();
    trigger.setAttribute('aria-expanded', 'false');
    field = null;
    if (restore && wasOpen && anchor?.isConnected) {
      attach(anchor);
      trigger.focus({preventScroll: true});
    } else {
      trigger.hidden = true;
      anchor = null;
    }
  }

  function fallbackField() {
    const source = document.createElement('textarea');
    source.readOnly = true;
    source.rows = 2;
    source.value = latex;
    return source;
  }

  async function open(candidate) {
    if (!candidate?.isConnected) return;
    if (anchor !== candidate || !panel.hidden) dismiss();
    attach(candidate);
    latex = formulaLatex(candidate);
    if (!latex) return;
    const generation = ++attempt;
    panel.hidden = false;
    panel.setAttribute('aria-label', trigger.textContent);
    trigger.setAttribute('aria-expanded', 'true');
    trigger.hidden = true;
    copy.textContent = tr('复制 LaTeX', 'Copy LaTeX');
    save.textContent = tr('摘录', 'Excerpt');
    save.hidden = !canExcerpt?.(candidate);
    close.textContent = tr('关闭', 'Close');
    status.textContent = '';
    field = fallbackField();
    mountField();
    try {
      const {isLatexFragment} = await import('./vendor/formula/editor.mjs?v=783abd1bfadc97a5');
      if (generation !== attempt || !candidate.isConnected || !isLatexFragment(latex)) return;
      // Keep a selection already made on the source while the editor was loading.
      if (field.selectionStart !== field.selectionEnd) return;
      const math = document.createElement('math-field');
      math.readOnly = true;
      math.mathVirtualKeyboardPolicy = 'manual';
      const restoreFocus = document.activeElement === field;
      field = math;
      mountField(false);
      math.menuItems = [];
      math.setValue(latex, {silenceNotifications: true});
      math.position = 0;
      if (restoreFocus) math.focus({preventScroll: true});
      position();
    } catch {
      if (generation === attempt && field?.localName === 'math-field') {
        field = fallbackField();
        mountField();
      }
    }
  }

  function mountField(focus = true) {
    field.className = 'formulaSelectionField';
    field.setAttribute('aria-label', tr('拖动或用键盘选择公式片段', 'Drag or use the keyboard to select a formula fragment'));
    surface.replaceChildren(field);
    if (focus) field.focus({preventScroll: true});
    position();
  }

  function value() {
    if (!field || !anchor?.isConnected || !anchor.getClientRects().length) return '';
    if (field.localName === 'textarea') return field.value.slice(field.selectionStart, field.selectionEnd) || latex;
    const ranges = field.selection?.ranges;
    if (!ranges?.some(([from, to]) => from !== to)) return latex;
    return field.getValue(field.selection, 'latex') || latex;
  }

  trigger.addEventListener('click', () => { void open(anchor); });
  for (const action of [copy, save]) action.addEventListener('pointerdown', event => event.preventDefault());
  close.addEventListener('click', () => dismiss(true));
  copy.addEventListener('click', async () => {
    const content = value(), generation = attempt;
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      if (generation === attempt) status.textContent = tr('已复制', 'Copied');
    } catch {
      if (generation !== attempt) return;
      field?.focus({preventScroll: true});
      status.textContent = tr('请按 Ctrl+C 或 ⌘C 复制', 'Press Ctrl+C or ⌘C to copy');
    }
  });
  save.addEventListener('click', () => {
    if (!anchor || !canExcerpt?.(anchor)) return;
    excerpt?.(anchor, value());
    dismiss();
  });
  surface.addEventListener('copy', event => {
    const content = value();
    if (!content || !event.clipboardData) return;
    event.clipboardData.setData('text/plain', content);
    event.preventDefault();
    event.stopPropagation();
    status.textContent = tr('已复制', 'Copied');
  }, true);
  document.addEventListener('pointerover', event => {
    if (tools.contains(event.target)) { clearTimeout(hoverTimeout); return; }
    if (!panel.hidden) return;
    const candidate = selectable(formulaAtPoint(event));
    if (candidate) attach(candidate);
    else if (!trigger.hidden) {
      clearTimeout(hoverTimeout);
      hoverTimeout = setTimeout(() => { if (panel.hidden && document.activeElement !== trigger) dismiss(); }, 220);
    }
  }, true);
  document.addEventListener('pointerdown', event => {
    if (!panel.hidden && !tools.contains(event.target)) dismiss();
    if (event.pointerType === 'touch' && panel.hidden) attach(selectable(formulaAtPoint(event)));
  }, true);
  document.addEventListener('dblclick', event => {
    const candidate = selectable(formulaAtPoint(event));
    if (!candidate || event.target.closest?.('a,label,button')) return;
    event.preventDefault();
    void open(candidate);
  });
  document.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape' && !panel.hidden) {
      event.preventDefault();
      event.stopPropagation();
      dismiss(true);
      return;
    }
    if (field?.localName === 'math-field' && event.target === field && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const command = keyCommands[event.key]?.[Number(event.shiftKey)];
      if (command) {
        event.preventDefault();
        event.stopPropagation();
        field.executeCommand(command);
      }
    }
    if (event.code === 'KeyF' && event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey
        && !elementOf(event.target)?.closest(interactive)) {
      const selection = getSelection();
      const candidate = selectable(selection?.anchorNode) || anchor ||
        [...document.querySelectorAll(formulaSelector)].map(selectable).find(node => {
          const rect = node?.getBoundingClientRect();
          return rect && rect.bottom > 0 && rect.top < innerHeight;
        });
      if (candidate) { event.preventDefault(); void open(candidate); }
    }
  }, true);
  window.addEventListener('hashchange', () => dismiss());
  window.addEventListener('resize', () => { if (anchor) position(); });
  window.addEventListener('scroll', () => { if (anchor) position(); }, {capture: true, passive: true});
}

// The shared clipper frame does not load the learning app entrypoint.
if (document.documentElement.hasAttribute('data-site-formula-selection')) installFormulaSelection();
