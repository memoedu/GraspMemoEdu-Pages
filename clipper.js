import {getLanguage} from './i18n.js?v=b166183de20b7ca0';
import {learningSelectionBlock} from './content-report.js?v=b166183de20b7ca0';
import {presentationMathSource} from './math-presentation.js?v=b166183de20b7ca0';
import {currentModal} from './question-tools.js?v=b166183de20b7ca0';

const FORMULA = '[data-math-source],[data-tex],.katex,math,mjx-container';
const EDITING = 'input,textarea,select,dialog,[contenteditable="true"]';
const EXCLUDED = 'script,style,template,[hidden],[inert],button,[role="toolbar"],[data-content-actions],.clipperActions,' + EDITING;
const CONTENT = '#portalContent,#lessonContent';
const TEXT_BLOCK = 'p,li,td,th,pre,blockquote,h1,h2,h3,h4,.courseContent,.answerContent,[data-paragraph]';
const limit = (text, length) => [...text].slice(0, length).join('');
const elementOf = node => node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
export const clipText = (zh, en) => getLanguage() === 'en' ? en : zh;
const touchLayout = () => window.matchMedia?.('(pointer: coarse) and (max-width: 800px)').matches;
export function openClipperPopup(explicit = false) {
  if (!explicit && touchLayout()) return null;
  let popup;
  try {
    popup = window.open('', '_blank', 'popup,width=790,height=660');
    if (popup && !popup.closed && popup.document.head && popup.document.body) return popup;
  } catch {}
  try { popup?.close(); } catch {}
  return null;
}

function formulaOf(node) {
  let math = elementOf(node)?.closest(FORMULA);
  while (math?.parentElement.closest(FORMULA)) math = math.parentElement.closest(FORMULA);
  return math;
}

function mathText(node) {
  const raw = node.getAttribute('data-math-source');
  if (raw) return raw;
  const tex = node.getAttribute('data-tex') ||
    node.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
  if (tex) return '\\(' + tex + '\\)';
  const spoken = node.getAttribute('aria-label') || node.querySelector('svg[aria-label]')?.getAttribute('aria-label');
  return presentationMathSource(node) || spoken || node.textContent;
}

function expandedRange(selection) {
  const raw = selection.getRangeAt(0).cloneRange();
  const start = formulaOf(raw.startContainer), end = formulaOf(raw.endContainer);
  if (!start && !end) return raw;
  const range = raw;
  if (start) range.setStartBefore(start);
  if (end) range.setEndAfter(end);
  return range;
}

// Read live DOM so omitted answers and collapsed content do not enter context.
function snapshot(root, range) {
  const output = [];
  const visit = node => {
    if (range && !range.intersectsNode(node)) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const start = node === range?.startContainer ? range.startOffset : 0;
      const end = node === range?.endContainer ? range.endOffset : node.length;
      output.push(node.data.slice(start, end));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || node.matches(EXCLUDED)) return;
    if (node.hidden || getComputedStyle(node).display === 'none' ||
        getComputedStyle(node).visibility === 'hidden') return;
    if (node.matches(FORMULA)) {
      output.push(' ', mathText(node), ' ');
      return;
    }
    if (node.getAttribute('aria-hidden') === 'true') return;
    if (node.matches('img')) {
      if (node.alt) output.push(node.alt);
      return;
    }
    if (node.matches('details:not([open])')) {
      const summary = node.querySelector(':scope > summary');
      if (summary) visit(summary);
      return;
    }
    for (const child of node.childNodes) visit(child);
    if (node.matches(TEXT_BLOCK + ',br,div,tr,section')) output.push('\n');
  };
  visit(root);
  return output.join('').replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function usable(node) {
  const el = elementOf(node);
  return el?.closest(CONTENT) && !el.closest(EXCLUDED);
}

function clipRoute() {
  const [path, search] = location.hash.split('?');
  if (!path?.startsWith('#/')) return '#/';
  const kept = new URLSearchParams();
  const full = new URLSearchParams(search);
  for (const key of ['course', 'root', 'section', 'question', 'material']) {
    const value = full.get(key);
    if (value) kept.set(key, value);
  }
  return limit(path + (kept.size ? '?' + kept : ''), 1020);
}

function capture() {
  const selection = getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  return captureRange(expandedRange(selection));
}

function captureRange(range) {
  const common = elementOf(range.commonAncestorContainer);
  const root = common?.closest(CONTENT);
  if (!root || !usable(range.startContainer) || !usable(range.endContainer)) return null;
  return {range, common, root};
}

function captureSource({range, common, root}) {
  if (!root.isConnected || !root.contains(common)) return null;
  const text = snapshot(common, range);
  if (!text) return null;
  const a = learningSelectionBlock(range.startContainer);
  const b = learningSelectionBlock(range.endContainer);
  const block = a && a === b ? a : common.closest(TEXT_BLOCK);
  const context = block ? snapshot(block) : text;
  const title = [...root.querySelectorAll('h1')].find(node => node.getClientRects().length)?.textContent || document.title;
  return {text: limit(text, 18000), context: limit(context, 18000),
    title: limit(title.trim(), 400), route: clipRoute()};
}

function select(node) {
  const range = document.createRange();
  if (node.matches(FORMULA)) range.selectNode(node);
  else range.selectNodeContents(node);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
  return range;
}

export function installClipper({request, identity}) {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'questionToolButton clipperToggle';
  toggle.dataset.questionTool = 'clipper';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', 'M7 3h10l2 2v16l-7-4-7 4V5a2 2 0 0 1 2-2zM9 8h6M9 11h6');
  svg.append(path);
  toggle.append(svg);
  const actions = document.createElement('div');
  actions.className = 'clipperActions';
  actions.setAttribute('role', 'group');
  actions.hidden = true;
  document.body.append(actions);
  const definitions = [['card', '卡', 'Card'], ['excerpt', '摘', 'Excerpt'], ['ask', '问', 'Ask'], ['read', '读', 'Read']];
  let owner, enabled = false, selection, app, hover, downOnMath, touch, loading = false, frame = 0;
  const storageKey = () => 'graspmemoedu:clipper:enabled:' + owner;

  function guardedRequest(...args) {
    const scope = owner;
    const current = () => scope && scope === owner && identity() === scope;
    if (!current()) throw new Error(clipText('账号已切换。', 'Your account changed.'));
    return request(...args).then(value => {
      if (!current()) throw new Error(clipText('账号已切换。', 'Your account changed.'));
      return value;
    });
  }

  function sync() {
    const label = clipText('零碎知识简藏', 'Knowledge Clipper');
    toggle.title = label;
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('aria-pressed', String(enabled));
    if (toggle.hidden === Boolean(owner)) toggle.hidden = !owner;
    document.body.classList.toggle('clipperSelectionEnabled', enabled);
    actions.setAttribute('aria-label', label);
    for (const [index, definition] of definitions.entries()) {
      actions.children[index].textContent = clipText(...definition.slice(1));
    }
  }

  function positionSelection() {
    const rect = selection && !currentModal() && selection.range.getBoundingClientRect();
    actions.hidden = !rect || rect.bottom <= 0 || rect.top >= innerHeight || (!rect.width && !rect.height);
    if (actions.hidden) return;
    const left = Math.max(8, Math.min(rect.left, innerWidth - actions.offsetWidth - 8));
    const bottom = rect.bottom + actions.offsetHeight + 12;
    const top = Math.max(6, Math.min(innerHeight - actions.offsetHeight - 6,
      bottom <= innerHeight ? rect.bottom + 6 : rect.top - actions.offsetHeight - 6));
    Object.assign(actions.style, {left: left + 'px', top: top + 'px'});
  }

  function showSelection() {
    if (!enabled || !owner || currentModal()) selection = null;
    else {
      const next = capture() || touch?.selection;
      if (next || !actions.contains(document.activeElement)) selection = next;
    }
    positionSelection();
  }

  function clearTouch() {
    touch?.formula.classList.remove('clipperTouchedFormula');
    touch = null;
  }

  function queueSelection() {
    if (!enabled || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; showSelection(); });
  }

  function preload() {
    return import('./clipper-workspace.js?v=b166183de20b7ca0').then(module => {
      if (!app) app = module.createClipperWorkspace({request: guardedRequest});
      return app;
    });
  }

  for (const [id] of definitions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.addEventListener('click', async () => {
      if (!selection || loading || !enabled || !owner) return;
      const source = captureSource(selection);
      if (!source) { actions.hidden = true; return; }
      const scope = owner;
      if (app) {
        app.open(id, source);
        return;
      }
      // Acquire the browser window during the action's trusted activation.
      const popup = openClipperPopup();
      loading = true;
      try {
        const workspace = await preload();
        if (!enabled || !owner || owner !== scope) { popup?.close(); return; }
        workspace.open(id, source, popup);
      } catch {
        popup?.close();
      } finally { loading = false; }
    });
    actions.append(button);
  }

  function refresh() {
    const next = identity();
    if (owner !== next) {
      app?.close();
      clearTouch();
      owner = next;
      enabled = false;
      if (owner) {
        try { enabled = localStorage.getItem(storageKey()) === 'yes'; } catch {}
      }
    }
    sync();
    showSelection();
    if (enabled) void preload().catch(() => {});
  }
  toggle.addEventListener('click', () => {
    if (!owner) return;
    enabled = !enabled;
    try { localStorage.setItem(storageKey(), enabled ? 'yes' : 'no'); } catch {}
    if (!enabled) { app?.close(); clearTouch(); }
    refresh();
  });
  actions.addEventListener('pointerdown', event => event.preventDefault());
  actions.addEventListener('focusout', queueSelection);
  document.addEventListener('selectionchange', queueSelection);
  document.addEventListener('pointerover', event => { hover = event.target; }, true);
  document.addEventListener('pointerdown', event => {
    if (touch && !actions.contains(event.target)) { clearTouch(); queueSelection(); }
    downOnMath = enabled && event.button === 0 && usable(event.target) ? formulaOf(event.target) : null;
  }, true);
  document.addEventListener('pointerup', event => {
    if (downOnMath && formulaOf(event.target) === downOnMath && getSelection()?.isCollapsed) select(downOnMath);
    downOnMath = null;
  }, true);
  document.addEventListener('click', event => {
    if (!enabled || (!touchLayout() && event.pointerType !== 'touch') || !usable(event.target) ||
        elementOf(event.target)?.closest('a,label')) return;
    const formula = formulaOf(event.target);
    if (formula) {
      event.preventDefault();
      clearTouch();
      // Some mobile engines remove the native selection after the tap dispatch.
      const range = select(formula).cloneRange();
      const captured = captureRange(range);
      if (captured) {
        touch = {formula, selection: captured};
        formula.classList.add('clipperTouchedFormula');
      }
      showSelection();
    }
  }, true);
  document.addEventListener('keydown', event => {
    if (!enabled || !owner || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey ||
        event.isComposing || elementOf(event.target)?.closest(EDITING) || currentModal()) return;
    if (event.code === 'KeyS') {
      const at = [getSelection()?.anchorNode, event.target, hover].find(usable);
      const fallback = [...document.querySelectorAll('#lessonContent [data-help-block],#portalContent [data-help-block]')]
        .find(node => usable(node) && node.getClientRects().length);
      const block = formulaOf(at) || learningSelectionBlock(at) || elementOf(at)?.closest(TEXT_BLOCK) || fallback;
      if (block) { event.preventDefault(); select(block); }
    } else if (event.code === 'KeyC') {
      showSelection();
      if (!actions.hidden) { event.preventDefault(); actions.firstElementChild.focus({preventScroll: true}); }
    }
  }, true);
  window.addEventListener('hashchange', () => { clearTouch(); selection = null; actions.hidden = true; });
  window.addEventListener('resize', positionSelection);
  window.addEventListener('scroll', positionSelection, {capture: true, passive: true});
  refresh();
  return {toggle, refresh};
}
