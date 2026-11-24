import {clipText as tx, openClipperPopup} from './clipper.js?v=96d6ac0e64adb146';
import {mountFloating, replayRecording} from './clipper-host.js?v=96d6ac0e64adb146';

const title = () => tx('零碎知识简藏', 'Knowledge Clipper');
const toolName = {
  card: () => tx('制卡', 'Make cards'), excerpt: () => tx('摘录', 'Excerpt'),
  ask: () => tx('快捷问答', 'Quick question'), read: () => tx('词义与朗读', 'Lookup and read aloud'), image:()=>tx('多图','Images'),
};

function create(doc, tag, text, className) {
  const item = doc.createElement(tag);
  if (text) item.textContent = text;
  if (className) item.className = className;
  return item;
}

function button(doc, label, action, className = 'secondaryButton') {
  const control = create(doc, 'button', label, className);
  control.type = 'button';
  control.addEventListener('click', action);
  return control;
}


function installStyles(doc) {
  if (doc === document || doc.head.querySelector('[data-clipper-styles]')) return;
  for (const stylesheet of document.querySelectorAll('link[rel="stylesheet"]')) {
    if (!/(?:styles|subjects|clipper|katex\.min)\.css\b/.test(stylesheet.href)) continue;
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = stylesheet.href;
    link.dataset.clipperStyles = '';
    doc.head.append(link);
  }
  doc.documentElement.lang = document.documentElement.lang;
  doc.title = title();
  doc.body.classList.add('clipperWindow');
}

export function createClipperWorkspace({request,identity,preferences,language}) {
  let surface, host, controls, panels, current;
  let collapsed = false, expanded = false;
  const sessions = [];


  function close() {
    const old = surface;
    surface = null;
    collapsed = expanded = false;

    for (const session of sessions) {session.closed=true;session.dispose?.();}
    sessions.length = 0;
    current = null;

    host?.remove();
    host = controls = panels = null;
    old?.close();
  }

  function attach(win) {
    if (win === window) win = null;
    const previous = surface;
    surface = win;
    const doc = win?.document || document;
    installStyles(doc);
    if (!host) {
      host = create(doc, 'section', '', 'clipperWorkspace');
      host.setAttribute('aria-label', title());
      controls = create(doc, 'header', '', 'clipperWindowBar');
      panels = create(doc, 'div', '', 'clipperPanels');
      host.append(controls, panels);
    }
    if (host.hasAttribute('popover')) host.hidePopover?.();
    host.removeAttribute('popover');
    if (!win && !host.hasAttribute('data-drag-enabled')) {
      host.dataset.dragEnabled = '';
      controls.addEventListener('pointerdown', event => {
        if (surface || expanded || event.button || event.target.closest('button')) return;
        const rect = host.getBoundingClientRect(), startX = event.clientX, startY = event.clientY;
        controls.setPointerCapture(event.pointerId);
        function move(next) {
          host.style.left = Math.min(innerWidth - 100, Math.max(0, rect.left + next.clientX - startX)) + 'px';
          host.style.top = Math.min(innerHeight - 48, Math.max(0, rect.top + next.clientY - startY)) + 'px';
        }
        controls.addEventListener('pointermove', move);
        controls.addEventListener('lostpointercapture', () => controls.removeEventListener('pointermove', move), {once: true});
      });
    }
    doc.body.append(host);
    host.classList.toggle('clipperDock', !win);
    collapsed = expanded = false;
    if (!win && typeof host.showPopover === 'function') {
      host.setAttribute('popover', 'manual');
      try { host.showPopover(); } catch { host.removeAttribute('popover'); }
    }
    win?.addEventListener('pagehide', () => { if (surface === win) close(); }, {once: true});
    renderBar();
    if (previous && previous !== win) previous.close();
  }

  function renderBar() {
    const doc = host.ownerDocument;
    const actions = create(doc, 'div', '', 'clipperButtons');
    const status = create(doc, 'span', '', 'clipperStatus');
    status.setAttribute('role', 'status');
    if (!surface) {
      actions.append(button(doc, tx('普通窗口', 'Regular window'), () => {
        const win = openClipperPopup(true);
        if (win) { attach(win); win.focus(); }
        else status.textContent = tx('浏览器拦截了新窗口。', 'Your browser blocked the new window.');
      }, 'textButton'));
      actions.append(button(doc, collapsed ? tx('恢复', 'Restore') : tx('最小化', 'Minimize'), () => {
        collapsed = !collapsed;
        if (collapsed) expanded = false;
        renderBar();
      }, 'textButton'));
      if (!collapsed) actions.append(button(doc, expanded ? tx('还原', 'Restore size') : tx('铺满标签页', 'Fill tab'), () => {
        expanded = !expanded;
        renderBar();
      }, 'textButton'));
    } else {
      actions.append(button(doc, tx('在当前页置顶', 'Keep on top of this tab'), () => attach(null), 'textButton'));
      actions.append(button(doc, tx('全屏', 'Full screen'), async () => {
        try {
          if (doc.fullscreenElement) await doc.exitFullscreen();
          else await host.requestFullscreen();
        } catch {
          status.textContent = tx('此窗口无法全屏。', 'This window could not enter full screen.');
        }
      }, 'textButton'));
    }
    actions.append(button(doc, tx('关闭', 'Close'), close, 'textButton'));
    host.classList.toggle('clipperCollapsed', collapsed);
    host.classList.toggle('clipperExpanded', expanded);
    panels.hidden = collapsed;
    const heading = create(doc, 'strong', title());
    controls.replaceChildren(heading, actions, status);
  }

  function show(session) {
    if(current!==session)current?.pause?.();
    current = session;
    const doc = host.ownerDocument;
    const nav = create(doc, 'nav', '', 'clipperTabs');
    if (sessions.length > 1) {
      nav.setAttribute('aria-label', tx('已打开的剪藏', 'Open clips'));
      for (const record of sessions) {
        const entry = button(doc, toolName[record.kind]() + ' · ' + [...record.source.text].slice(0, 12).join(''),
          () => show(record), 'textButton');
        entry.setAttribute('aria-pressed', String(record === session));
        nav.append(entry);
      }
    }
    panels.querySelector(':scope > nav')?.remove();panels.prepend(nav);
    if(!session.panel.isConnected)panels.append(session.panel);
    for(const item of sessions)item.panel.hidden=item!==session;
  }

  function open(kind, source, opened) {
    if (surface?.closed) close();
    if (!host) attach(opened === undefined ? openClipperPopup() : opened);
    else if (opened) {
      if (!surface) attach(opened);
      else opened.close();
    }
    if (collapsed) { collapsed = false; renderBar(); }
    if (sessions.length >= 24) {
      show(current);
      controls.querySelector('[role="status"]').textContent = tx(
        '当前窗口的剪藏已满，保存草稿并关闭窗口后可重新打开。', 'Save your drafts and close this window to start a new clip.');
      return;
    }
    const doc = host.ownerDocument;
    const panel = create(doc, 'section', '', 'clipperPanel');
    const session = {kind, source, panel, closed: false};
    sessions.push(session);
    show(session);
    surface?.focus();
    session.panel.classList.add('clipperSharedPanel');
    mountFloating(session,{request,identity,preferences,language}).catch(error=>{
      if(!session.closed)session.panel.replaceChildren(create(doc,'p',error.message,'fieldError'));
    });
  }

  window.addEventListener('pagehide', close);
  return {open,close,replay:()=>replayRecording(identity())};
}
