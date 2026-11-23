import {t} from './i18n.js?v=ac18bacda6f39812';

const blocks = new WeakMap();
const helpBlocks = new WeakMap();
const actionHosts = new WeakMap();
let helpPolicy = null, showHelp = null;
export function visibleContentTopics() {
  return [...new Set([...document.querySelectorAll('[data-help-block]')]
    .filter(element => !element.closest('[hidden]') && element.getClientRects().length)
    .map(element => helpBlocks.get(element)?.topic_id).filter(Boolean))];
}
export function helpableContent(element, context, contentBlockId, contentVersion) {
  if (!contentVersion || !context.topic_id) return element;
  element.dataset.helpBlock = contentBlockId;
  helpBlocks.set(element, {...context, content_block_id: contentBlockId, content_version: contentVersion});
  updateHelpButton(element);
  return element;
}
export function placeContentActions(element, host) {
  actionHosts.set(element, host);
  for (const actions of element.querySelectorAll(':scope > .contentReportActions, :scope > .trainingNotebookActions')) host.append(actions);
}
function updateHelpButton(element) {
  const host = actionHosts.get(element) || element;
  let actions = host.querySelector(':scope > [data-content-actions]');
  if (!helpPolicy?.()?.features?.includes('request_help')) { actions?.remove(); return; }
  if (actions) return;
  actions = document.createElement('div'); actions.className = 'contentReportActions'; actions.dataset.contentActions = 'true';
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.className = 'contentReportToggle'; toggle.textContent = '?';
  toggle.setAttribute('aria-label', t('portal.question.help.78'));
  const menu = document.createElement('div'); menu.className = 'contentReportMenu';
  function setOpen(open) {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  }
  setOpen(false);
  actions.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') setOpen(true); });
  actions.addEventListener('pointerleave', event => {
    if (event.pointerType === 'mouse' && !menu.contains(document.activeElement)) setOpen(false);
  });
  toggle.addEventListener('click', event => setOpen(event.pointerType === 'mouse' || menu.hidden));
  actions.addEventListener('focusout', event => {
    if (!actions.contains(event.relatedTarget)) setOpen(false);
  });
  actions.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || menu.hidden) return;
    event.stopPropagation();
    toggle.focus(); setOpen(false);
  });
  for (const kind of ['quality', 'help']) {
    const action = document.createElement('button'); action.type = 'button';
    action.className = `textButton ${kind === 'quality' ? 'contentQualityButton' : 'requestHelpButton'}`;
    action.dataset.helpAction = kind; action.textContent = t(kind === 'quality' ? 'help.quality' : 'help.request');
    action.addEventListener('click', () => {
      toggle.focus(); setOpen(false);
      showHelp?.({...helpBlocks.get(element), kind});
    });
    menu.append(action);
  }
  actions.append(toggle, menu);
  if (host === element) element.prepend(actions); else host.append(actions);
}
export function installHelpRequests(getAccess, open) {
  helpPolicy = getAccess; showHelp = open;
  return {refresh() { document.querySelectorAll('[data-help-block]').forEach(updateHelpButton); }};
}
export function reportableContent(element, context, contentBlockId, contentVersion) {
  if (!contentVersion || !context.topic_id) return element;
  element.dataset.reportBlock = contentBlockId;
  blocks.set(element, {...context, correction: {content_block_id: contentBlockId, content_version: contentVersion}});
  return helpableContent(element, context, contentBlockId, contentVersion);
}

// Blanks replace author markers in the live DOM. Restore the markers in a
// detached range clone so the reported character offsets match stored HTML.
function rangeText(range) {
  const fragment = range.cloneContents();
  fragment.querySelectorAll('[data-content-actions], [data-help-action]').forEach(action => action.remove());
  for (const math of fragment.querySelectorAll('[data-math-source]')) math.replaceWith(document.createTextNode(math.dataset.mathSource));
  for (const input of fragment.querySelectorAll('[data-blank-id]')) input.replaceWith(document.createTextNode(`{{blank:${input.dataset.blankId}}}`));
  return fragment.textContent;
}

export function installContentReporting(showFeedback) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'reportSelectionButton'; button.id = 'reportSelectionButton';
  button.hidden = true; button.textContent = t('correction.report'); document.body.append(button);
  let captured = null;
  const blockOf = node => (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement)?.closest('[data-report-block]');
  function capture() {
    const selection = document.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0), block = blockOf(range.startContainer);
    const insideMath = node => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest('[data-math-source]');
    if (insideMath(range.startContainer) || insideMath(range.endContainer)) return null;
    if (!block || block !== blockOf(range.endContainer) || !blocks.has(block) || block.closest('[hidden]')) return null;
    const exact = rangeText(range);
    if (!exact.trim() || [...exact].length > 2000) return null;
    const before = document.createRange(), after = document.createRange();
    before.selectNodeContents(block); before.setEnd(range.startContainer, range.startOffset);
    after.selectNodeContents(block); after.setStart(range.endContainer, range.endOffset);
    const prefix = [...rangeText(before)], suffix = [...rangeText(after)];
    const context = blocks.get(block);
    return {...context, correction: {...context.correction, quote: {
      exact, prefix: prefix.slice(-50).join(''), suffix: suffix.slice(0, 50).join(''),
      start: prefix.length, end: prefix.length + [...exact].length,
    }}};
  }
  function open(context) {
    if (!context) return;
    button.hidden = true; showFeedback(context);
  }
  document.addEventListener('selectionchange', () => {
    if (document.querySelector('dialog[open]')) { button.hidden = true; return; }
    captured = capture(); button.hidden = !captured;
  });
  button.addEventListener('pointerdown', event => event.preventDefault());
  button.addEventListener('click', () => open(captured));
  document.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter' || event.isComposing
      || event.target.closest('input,textarea,[contenteditable="true"],dialog')) return;
    const context = capture();
    if (context) { event.preventDefault(); event.stopPropagation(); open(context); }
  }, true);
  const clear = () => { captured = null; button.hidden = true; };
  window.addEventListener('hashchange', clear);
  return {clear};
}
