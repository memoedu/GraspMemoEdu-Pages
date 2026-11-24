import {getLanguage} from './i18n.js?v=00493ad7a36c230c';
import {learningSelectionBlock} from './content-report.js?v=00493ad7a36c230c';
import {captureSelection, formulaAt, formulaSelector} from './clipper-selection.js?v=00493ad7a36c230c';
import {currentModal} from './question-tools.js?v=00493ad7a36c230c';

const FORMULA = formulaSelector;
const EDITING = 'input,textarea,select,dialog,[contenteditable="true"]';
const EXCLUDED = 'script,style,template,[hidden],[inert],button,[role="toolbar"],[data-content-actions],.clipperActions,' + EDITING;
const CONTENT = '#portalContent,#lessonContent';
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
  if (!root || !usable(range.startContainer) || !usable(range.endContainer)) return null;
  return {range, common, root};
}

function captureSource({range, common, root}) {
  if (!root.isConnected || !root.contains(common)) return null;
  const selection = captureSelection(range,root);
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
  let prefs, pending, imageSelection;
  let owner, enabled = false, selection, app, hover, loading = false, frame = 0;

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
    const label = clipText('零碎知识简藏', 'Knowledge Clipper');
    toggle.title = label;
    toggle.setAttribute('aria-label', label);
    toggle.setAttribute('aria-pressed', String(enabled));
    if (toggle.hidden === Boolean(owner)) toggle.hidden = !owner;
    actions.setAttribute('aria-label', label);
    renderActions();
  }

  function positionSelection() {
    const rect = selection && !currentModal() && selection.range.getBoundingClientRect();
    actions.hidden = !actions.childElementCount || !rect || rect.bottom <= 0 || rect.top >= innerHeight || (!rect.width && !rect.height);
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
      const next = capture() || imageSelection;
      if (next || !actions.contains(document.activeElement)) selection = next;
    }
    renderActions();
    positionSelection();
  }

  function queueSelection() {
    if (!enabled || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; showSelection(); });
  }

  function preload() {
    return import('./clipper-workspace.js?v=00493ad7a36c230c').then(module => {
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
  async function openSource(id, source) {
    if (loading || !enabled || !owner || owner !== identity()) return;
    const scope = owner;
    loading = true;
    try {
      const workspace = await preload();
      if (enabled && scope === owner && owner === identity()) workspace.open(id, source);
    } finally { loading = false; }
  }
  function invoke(id, originalExcerpt = false) {
    const source = selection && captureSource(selection);
    if (source) return openSource(id, {...source, originalExcerpt});
  }
  function refresh() {
    const next = identity();
    if (owner !== next) {
      app?.close(); app=null; prefs=pending=null; imageSelection=null;
      owner = next;
      enabled = clipperEnabled(owner);
    }
    sync();
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
  document.addEventListener('selectionchange', queueSelection);
  document.addEventListener('pointerover', event => { hover = event.target; }, true);
  document.addEventListener('pointerdown', event => {
    if(!actions.contains(event.target))imageSelection=null;
  }, true);
  document.addEventListener('pointerup', event => {
    const picture=elementOf(event.target)?.closest('img');
    if(enabled && picture && usable(picture) && !formulaAt(picture) && !picture.closest('a,button,label') && getSelection()?.isCollapsed){
      const range=document.createRange();range.selectNode(picture);
      const captured=captureRange(range);
      if(captured){imageSelection={...captured,image:picture};showSelection();}
    }
  }, true);
  document.addEventListener('keydown', event => {
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
      const fallback = [...document.querySelectorAll('#lessonContent [data-help-block],#portalContent [data-help-block]')]
        .find(node => usable(node) && node.getClientRects().length);
      const block = formulaAt(at) || learningSelectionBlock(at) || elementOf(at)?.closest(TEXT_BLOCK) || fallback;
      if (block) { event.preventDefault(); select(block); }
    } else if (event.code === 'KeyC') {
      showSelection();
      if (!actions.hidden) { event.preventDefault(); actions.firstElementChild.focus({preventScroll: true}); }
    }
  }, true);
  window.addEventListener('hashchange', () => { imageSelection=null; selection = null; actions.hidden = true; });
  window.addEventListener('resize', positionSelection);
  window.addEventListener('scroll', positionSelection, {capture: true, passive: true});
  const invalidate=()=>{prefs=pending=null;refresh();};
  window.addEventListener('clipper-settings-changed',invalidate);
  try {const channel=new BroadcastChannel('clipper-settings');channel.onmessage=invalidate;window.addEventListener('pagehide',()=>channel.close(),{once:true});}catch{}
  refresh();
  return {toggle, refresh};
}
