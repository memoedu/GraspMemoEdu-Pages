import {getLanguage} from './i18n.js?v=f4e8cccd42a8abae';
import {learningSelectionBlock} from './content-report.js?v=f4e8cccd42a8abae';
import {captureSelection, formulaAt, formulaSelector, readingSourceSelector} from './clipper-selection.js?v=f4e8cccd42a8abae';
import {createClipperLines} from './clipper-lines.js?v=f4e8cccd42a8abae';
import {currentModal, toolbarAction, toolbarExtension} from './question-tools.js?v=f4e8cccd42a8abae';
import {clipperAcquisition} from './clipper-acquisition.js?v=f4e8cccd42a8abae';

const FORMULA = formulaSelector;
const EDITING = 'input,textarea,select,dialog,[contenteditable="true"]';
const EXCLUDED = 'script,style,template,[hidden],[inert],button,[role="toolbar"],[data-content-actions],.clipperActions,' + EDITING;
const CONTENT = '#portalContent,#lessonContent,[data-learning-page]';
const TEXT_BLOCK = 'p,li,td,th,pre,blockquote,h1,h2,h3,h4,.courseContent,.answerContent,[data-paragraph]';
const limit = (text, length) => [...text].slice(0, length).join('');
const elementOf = node => node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
export const clipText = (zh, en) => getLanguage() === 'en' ? en : zh;
const enabledKey = owner => 'graspmemoedu:clipper:enabled:' + owner;
export function clipperEnabled(owner) {
  try {return Boolean(owner) && localStorage.getItem(enabledKey(owner)) === 'yes';} catch {return false;}
}
export function setClipperEnabled(owner, enabled) {
  if (!owner) return;
  try {localStorage.setItem(enabledKey(owner), enabled ? 'yes' : 'no');} catch {}
  window.dispatchEvent(new CustomEvent('clipper-toggle', {detail:{owner, enabled}}));
}
export function openClipperPopup(explicit = false) {
  if (!explicit) return null;
  let popup;
  try {
    popup = window.open('', '_blank', 'popup,width=790,height=660');
    if (popup && !popup.closed && popup.document.head && popup.document.body) {
      if(popup.document.compatMode!=='CSS1Compat'){
        popup.document.open();popup.document.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');popup.document.close();
      }
      return popup;
    }
  } catch {}
  try { popup?.close(); } catch {}
  return null;
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
  return captureRange(selection.getRangeAt(0).cloneRange());
}

function captureRange(range) {
  const common = elementOf(range.commonAncestorContainer);
  const root = common?.closest(CONTENT);
  const routeHash = location.hash;
  if (root && usable(range.startContainer) && usable(range.endContainer)) return {range, common, root, routeHash};
  // A drag can start or end outside the reading surface. Keep its actual
  // intersection with mounted content, including selections crossing the page shell.
  const visible = root || [...document.querySelectorAll(CONTENT)].find(node =>
    node.getClientRects().length && !node.closest('[hidden],[inert]') && range.intersectsNode(node) &&
    (range.comparePoint(node, 0) === 0 && range.comparePoint(node, node.childNodes.length) === 0 ||
      [...node.querySelectorAll(readingSourceSelector)].some(block => range.intersectsNode(block))));
  if (!visible) return null;
  const bounds = document.createRange();
  bounds.selectNodeContents(visible);
  if (range.compareBoundaryPoints(Range.START_TO_START, bounds) < 0) range.setStart(visible, 0);
  if (range.compareBoundaryPoints(Range.END_TO_END, bounds) > 0) range.setEnd(visible, visible.childNodes.length);
  if (range.collapsed) return null;
  return {range, common: elementOf(range.commonAncestorContainer), root: visible, routeHash};
}

function captureSource({range, ranges, common, root, routeHash}) {
  if (!root.isConnected || root.closest('[hidden],[inert]') || (common && !root.contains(common)) ||
      (routeHash !== undefined && routeHash !== location.hash)) return null;
  const parts = (ranges || [range]).map(part => captureSelection(part, root)).filter(Boolean);
  let selection = parts[0];
  if (parts.length > 1) {
    const assets = [];
    const text = parts.map(part => {
      const offset = assets.length;
      assets.push(...part.assets);
      return part.text.replace(/(!\[[^\]]*\]\(clipper-image:)(\d+)(\))/g,
        (_match, start, index, end) => start + (offset + Number(index)) + end);
    }).join('\n\n');
    selection = {text, assets, prefix: '', suffix: '', isImage: false,
      hasCompleteFormula: parts.some(part => part.hasCompleteFormula)};
  }
  if (!selection) return null;
  const title = [...root.querySelectorAll('h1')].find(node => node.getClientRects().length)?.textContent || document.title;
  return {...selection, title:limit(title.trim(),400),route:clipRoute()};
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
  const label = () => clipText('零碎知识简藏', 'Knowledge Clipper');
  const toggle = toolbarAction('clipper', 'M7 3h10l2 2v16l-7-4-7 4V5a2 2 0 0 1 2-2zM9 8h6M9 11h6');
  toggle.classList.add('clipperToggle');
  const acquisition = clipperAcquisition({label: label(), text: clipText, onOpen: openSource, pageSource, externalSource});
  const extension = toolbarExtension(toggle, (panel, hide) => acquisition.render(panel, hide, toggle));
  const actions = document.createElement('div');
  actions.className = 'clipperActions';
  actions.setAttribute('role', 'group');
  actions.hidden = true;
  document.body.append(actions);
  let prefs, pending, imageSelection;
  let owner, enabled = false, selection, app, hover, loading = false, frame = 0;
  const lineSelectors = new Map();
  function captureLines() {
    for (const selector of lineSelectors.values()) {
      const captured = selector.capture();
      if (captured) return captured;
    }
    return null;
  }
  const clearLines = () => lineSelectors.forEach(selector => selector.clear());

  function syncLines() {
    const roots = enabled && owner ? [...document.querySelectorAll(CONTENT)]
      .filter(root => !root.parentElement?.closest(CONTENT)) : [];
    for (const [root, selector] of lineSelectors) {
      if (roots.includes(root)) continue;
      selector.destroy();
      lineSelectors.delete(root);
    }
    for (const root of roots) {
      if (lineSelectors.has(root)) lineSelectors.get(root).refresh();
      else lineSelectors.set(root, createClipperLines(root, {
        onChange: queueSelection, blocked: () => currentModal() || tutorSelecting(), actions,
      }));
    }
  }

  function guardedRequest(...args) {
    const scope = owner;
    const current = () => scope && scope === owner && identity() === scope;
    if (!current()) throw new Error(clipText('账号已切换。', 'Your account changed.'));
    return request(...args).then(value => {
      if (!current()) throw new Error(clipText('账号已切换。', 'Your account changed.'));
      return value;
    });
  }

  async function preferences() {
    if(prefs)return prefs;
    if(!pending){
      const task=guardedRequest('clipper/settings').then(value=>{
        if(task!==pending)throw new Error(clipText('设置已更新，请重新选择。','Settings changed. Select again.'));
        prefs=value;return value;
      }).finally(()=>{if(task===pending)pending=null;});
      pending=task;
    }
    return pending;
  }
  function sync() {
    toggle.title = label();
    toggle.setAttribute('aria-label', label());
    toggle.setAttribute('aria-pressed', String(enabled));
    if (toggle.hidden === Boolean(owner)) toggle.hidden = !owner;
    if (extension.item.hidden === Boolean(owner)) extension.item.hidden = !owner;
    actions.setAttribute('aria-label', label());
    renderActions();
  }

  function positionSelection() {
    const rect = selection && !currentModal() && (selection.ranges ? selection.anchor?.getBoundingClientRect() : selection.range.getBoundingClientRect());
    actions.hidden = !actions.childElementCount || !rect || rect.bottom <= 0 || rect.top >= innerHeight || (!rect.width && !rect.height);
    if (actions.hidden) return;
    const anchorX = selection.ranges ? rect.right - actions.offsetWidth : rect.left;
    const left = Math.max(8, Math.min(anchorX, innerWidth - actions.offsetWidth - 8));
    const bottom = rect.bottom + actions.offsetHeight + 12;
    const top = Math.max(6, Math.min(innerHeight - actions.offsetHeight - 6,
      bottom <= innerHeight ? rect.bottom + 6 : rect.top - actions.offsetHeight - 6));
    Object.assign(actions.style, {left: left + 'px', top: top + 'px'});
  }

  function showSelection() {
    if (!enabled || !owner || acquisition.selecting || tutorSelecting() || currentModal() ||
        [...lineSelectors.values()].some(selector => selector.dragging)) selection = null;
    else {
      const native = capture();
      if (native || imageSelection) clearLines();
      const next = native || imageSelection || captureLines();
      if (next || selection?.ranges || !actions.contains(document.activeElement)) selection = next;
    }
    renderActions();
    positionSelection();
  }

  function queueSelection() {
    if (!enabled || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; showSelection(); });
  }

  function preload() {
    return import('./clipper-workspace.js?v=f4e8cccd42a8abae').then(module => {
      if (!app) app = module.createClipperWorkspace({request: guardedRequest, identity:()=>owner, preferences, language:getLanguage});
      return app;
    });
  }

  function renderActions(){
    const image=!!selection?.image;
    const definitions=!prefs||image&&!prefs.values.clipboardImageDotEnabled?[]:prefs.workflow[image?'image':'text'];
    const signature=definitions.map(d=>d.id).join(',')+getLanguage();
    if(actions.dataset.signature===signature)return;
    actions.dataset.signature=signature;
    actions.replaceChildren(...definitions.map(def=>{
      const button=document.createElement('button');button.type='button';button.dataset.action=def.id;
      button.textContent=clipText(def.label,def.englishLabel);button.onclick=()=>invoke(def.id);return button;
    }));
  }
  const tutorSelecting = () => document.body.hasAttribute('data-tutor-selecting');
  function externalSource(value) {
    const isImage = value instanceof Blob;
    return {title: document.title, route: clipRoute(), text: isImage ? label() : limit(value, 18000),
      assets: isImage ? [value] : [], isImage};
  }
  function pageSource(image, target) {
    if (!image) {
      const picked = capture() || captureLines();
      const source = picked && captureSource(picked);
      if (source && /\S/u.test(source.text.replace(/!\[[^\]]*\]\(clipper-image:\d+\)/g, ''))) return {...source, isImage: false};
      return null;
    }
    const picture = elementOf(target)?.closest('img');
    if (!picture || !usable(picture) || formulaAt(picture)) return null;
    const range = document.createRange();
    range.selectNode(picture);
    const picked = captureRange(range);
    const source = picked && captureSource(picked);
    return source?.assets.length ? {...source, isImage: true} : null;
  }
  async function openSource(id, source) {
    if (loading || !owner || owner !== identity()) return;
    const scope = owner;
    const route = location.hash;
    loading = true;
    try {
      const workspace = await preload();
      if (scope === owner && owner === identity() && route === location.hash) workspace.open(id, source);
    } finally { loading = false; }
  }
  function invoke(id, originalExcerpt = false) {
    const source = selection && captureSource(selection);
    if (source) return openSource(id, {...source, originalExcerpt});
  }
  function refresh() {
    const next = identity();
    if (owner !== next) {
      acquisition.stop();
      extension.hide();
      app?.close(); app=null; prefs=pending=null; imageSelection=null;
      clearLines();
      owner = next;
      enabled = clipperEnabled(owner);
    }
    syncLines(); sync();
    showSelection();
    if(enabled && !prefs)void preferences().then(()=>{sync();showSelection();}).catch(()=>{});
  }
  const updateEnabled = value => {
    enabled = value;
    if (!enabled) app?.close();
    refresh();
  };
  toggle.addEventListener('click', () => setClipperEnabled(owner, !enabled));
  window.addEventListener('clipper-toggle', event => {
    if (owner && event.detail?.owner === owner) updateEnabled(event.detail.enabled);
  });
  window.addEventListener('storage', event => {
    if (owner && event.key === enabledKey(owner)) updateEnabled(clipperEnabled(owner));
  });
  actions.addEventListener('pointerdown', event => event.preventDefault());
  actions.addEventListener('focusout', queueSelection);
  window.addEventListener('copy', event => {
    if (event.defaultPrevented || !event.clipboardData || elementOf(event.target)?.closest(EDITING) || currentModal()) return;
    const source = capture() || captureLines();
    const material = source && captureSource(source);
    if (!material || (!source.ranges && !material.hasReadingSource && !material.hasCompleteFormula)) return;
    const text = material.text.replace(/!\[([^\]]*)\]\(clipper-image:\d+\)/g, '$1');
    event.clipboardData.setData('text/plain', text);
    event.preventDefault();
    // A later copy listener can overwrite this event's clipboard with rendered glyphs.
    event.stopImmediatePropagation();
  }, {capture: true});
  document.addEventListener('selectionchange', queueSelection);
  document.addEventListener('pointerover', event => { hover = event.target; }, true);
  document.addEventListener('pointerdown', event => {
    if(!actions.contains(event.target))imageSelection=null;
  }, true);
  document.addEventListener('pointerup', event => {
    const picture=elementOf(event.target)?.closest('img');
    if(enabled && !acquisition.selecting && !tutorSelecting() && picture && usable(picture) && !formulaAt(picture) && !picture.closest('a,button,label') && getSelection()?.isCollapsed){
      const range=document.createRange();range.selectNode(picture);
      const captured=captureRange(range);
      if(captured){imageSelection={...captured,image:picture};showSelection();}
    }
  }, true);
  document.addEventListener('keydown', event => {
    if (!elementOf(event.target)?.closest(EDITING) && !currentModal() &&
        (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a'))) clearLines();
    if(enabled&&owner&&!event.isComposing&&!elementOf(event.target)?.closest(EDITING)&&prefs){
      const match=(key)=>{
        const parts=(key||'').toLowerCase().split('+'), last=parts.pop();
        return event.altKey===parts.includes('alt')&&event.shiftKey===parts.includes('shift')&&event.ctrlKey===parts.includes('ctrl')&&
          event.metaKey===parts.includes('meta')&&(event.key.toLowerCase()===last||({'《':'Comma','<':'Comma','/':'Slash'})[last]===event.code);
      };
      if(match(prefs.values.originalExcerptHotkey)&&selection){event.preventDefault();void invoke('excerpt',true);return;}
      if(match(prefs.values.replayLastHotkey)){event.preventDefault();void preload().then(workspace=>workspace.replay());return;}
    }
    if (!enabled || !owner || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey ||
        event.isComposing || elementOf(event.target)?.closest(EDITING) || currentModal()) return;
    if (event.code === 'KeyS') {
      const at = [getSelection()?.anchorNode, event.target, hover].find(usable);
      const fallback = [...document.querySelectorAll('[data-help-block]')]
        .find(node => usable(node) && node.getClientRects().length);
      const block = formulaAt(at) || learningSelectionBlock(at) || elementOf(at)?.closest(TEXT_BLOCK) || fallback;
      if (block) { event.preventDefault(); select(block); }
    } else if (event.code === 'KeyC') {
      showSelection();
      if (!actions.hidden) { event.preventDefault(); actions.firstElementChild.focus({preventScroll: true}); }
    }
  }, true);
  window.addEventListener('hashchange', () => { acquisition.stop(); extension.hide(); clearLines(); imageSelection=null; selection = null; actions.hidden = true; });
  const contentObserver = new MutationObserver(records => {
    if (enabled && records.some(record => [...record.addedNodes, ...record.removedNodes]
      .some(node => node.nodeType === Node.ELEMENT_NODE && (node.matches(CONTENT) || node.querySelector(CONTENT))))) syncLines();
  });
  contentObserver.observe(document.body, {childList: true, subtree: true});
  window.addEventListener('resize', positionSelection);
  window.addEventListener('scroll', () => { if (selection?.ranges) queueSelection(); else positionSelection(); }, {capture: true, passive: true});
  const invalidate=()=>{prefs=pending=null;refresh();};
  window.addEventListener('clipper-settings-changed',invalidate);
  try {const channel=new BroadcastChannel('clipper-settings');channel.onmessage=invalidate;window.addEventListener('pagehide',()=>channel.close(),{once:true});}catch{}
  refresh();
  return {extension, refresh, openAsk: source => openSource('ask', {route: clipRoute(), title: document.title, ...source})};
}
