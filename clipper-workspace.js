import {clipText as tx, openClipperPopup} from './clipper.js?v=b166183de20b7ca0';
import {renderPlainMath} from './math-presentation.js?v=b166183de20b7ca0';

const title = () => tx('零碎知识简藏', 'Knowledge Clipper');
const toolName = {
  card: () => tx('制卡', 'Make cards'), excerpt: () => tx('摘录', 'Excerpt'),
  ask: () => tx('快捷问答', 'Quick question'), read: () => tx('词义与朗读', 'Lookup and read aloud'),
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

function renderText(doc, text, className = 'clipperText') {
  const block = create(doc, 'div', text, className);
  renderPlainMath(block, text);
  return block;
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

export function createClipperWorkspace({request}) {
  let surface, host, controls, panels, current, types;
  let collapsed = false, expanded = false;
  const sessions = [];
  const speak = window.speechSynthesis;

  function close() {
    const old = surface;
    surface = null;
    collapsed = expanded = false;
    speak?.cancel();
    for (const session of sessions) session.closed = true;
    sessions.length = 0;
    current = null;
    types = null;
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
    if (current !== session) speak?.cancel();
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
    panels.replaceChildren(nav, session.panel);
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
    build(session);
  }

  function build(session) {
    const {kind, source, panel} = session;
    const doc = panel.ownerDocument;
    const status = create(doc, 'p', '', 'clipperStatus');
    status.setAttribute('role', 'status');
    panel.append(create(doc, 'h1', toolName[kind]()));
    const sample = create(doc, 'details', '', 'clipperSource');
    sample.open = kind === 'excerpt' || kind === 'read';
    sample.append(create(doc, 'summary', source.title || tx('所选内容', 'Selected content')), renderText(doc, source.text));
    let includeContext;
    if (source.context && source.context !== source.text && kind !== 'excerpt') {
      const label = create(doc, 'label', '', 'clipperCheck');
      includeContext = create(doc, 'input');
      includeContext.type = 'checkbox';
      label.append(includeContext, tx('带入所在内容块', 'Include surrounding content'));
      const context = renderText(doc, source.context);
      context.hidden = true;
      includeContext.addEventListener('change', () => { context.hidden = !includeContext.checked; });
      sample.append(label, context);
    }
    const sourceData = () => ({...source, context: includeContext?.checked ? source.context : ''});
    panel.append(sample, status);

    let busy = false;
    async function run(control, work, working) {
      if (busy) return;
      busy = true;
      control.disabled = true;
      status.textContent = working;
      try {
        await work();
      } catch (error) {
        if (!session.closed) status.textContent = error.message;
      } finally {
        busy = false;
        if (!session.closed) control.disabled = false;
      }
    }

    const save = (id, data) => request('clipper/items', {method: 'POST', body: {id, ...data, source: sourceData()}});
    const api = body => request('clipper/model', {method: 'POST', body: {...body, source: sourceData()}, timeout: 40000});
    const saved = () => tx('已存入个人自由学习。', 'Saved to Independent Study.');
    const saving = () => tx('正在保存…', 'Saving…');
    if (kind === 'excerpt') {
      const id = crypto.randomUUID();
      const control = button(doc, tx('保存摘录', 'Save excerpt'), () => void run(control, async () => {
        await save(id, {kind, type_id: 'excerpt-manual', front: source.text, back: ''});
        if (!session.closed) status.textContent = saved();
      }, saving()), 'primaryButton');
      panel.append(control);
      return;
    }
    if (kind === 'read') {
      const output = create(doc, 'div');
      const play = button(doc, tx('朗读选区', 'Read aloud'), () => {
        const language = /[\u3040-\u30ff]/.test(source.text) ? 'ja' : /[\uac00-\ud7af]/.test(source.text) ? 'ko'
          : /\p{Script=Han}/u.test(source.text) ? 'zh' : 'en';
        const voice = speak?.getVoices().find(v => v.localService && v.lang.toLowerCase().startsWith(language));
        if (!voice) {
          status.textContent = tx('设备上没有对应语言的本地语音。', 'No local voice is installed for this language.');
          return;
        }
        speak.cancel();
        const utterance = new SpeechSynthesisUtterance(source.text);
        utterance.voice = voice;
        utterance.lang = voice.lang;
        utterance.onerror = event => {
          if (!session.closed && !['interrupted', 'canceled'].includes(event.error))
            status.textContent = tx('朗读失败，请重试。', 'Playback failed. Try again.');
        };
        speak.speak(utterance);
      });
      const lookup = button(doc, tx('查询词义', 'Look up meaning'), () => void run(lookup, async () => {
        const result = await api({action: 'lookup'});
        if (session.closed) return;
        output.replaceChildren();
        if (result.text) output.append(renderText(doc, result.text));
        else {
          for (const sense of result.senses) {
            const row = create(doc, 'section', '', 'clipperSense');
            row.append(create(doc, 'strong', sense.lemma + ' · ' + sense.pos),
              create(doc, 'p', sense.definition));
            for (const example of sense.examples) row.append(create(doc, 'p', example));
            output.append(row);
          }
          const credit = create(doc, 'a', result.dictionary.name + ' ' + result.dictionary.version);
          credit.href = result.dictionary.url;
          credit.target = '_blank';
          credit.rel = 'noopener noreferrer';
          output.append(credit);
        }
        status.textContent = '';
      }, tx('正在查询词义…', 'Looking up meaning…')), 'primaryButton');
      const row = create(doc, 'div', '', 'clipperButtons');
      row.append(lookup, play, button(doc, tx('停止朗读', 'Stop reading'), () => speak?.cancel()));
      panel.append(row, output);
      speak?.getVoices();
      return;
    }

    const turns = [], messages = create(doc, 'div', '', 'clipperChat');
    messages.setAttribute('aria-live', 'polite');
    const type = create(doc, 'select');
    const typeLabel = create(doc, 'label', tx('卡片类型', 'Card type'));
    typeLabel.append(type);
    function field(text, length) {
      const label = create(doc, 'label', text);
      const input = create(doc, 'textarea');
      input.maxLength = length;
      label.append(input);
      return {label, input};
    }
    const question = field(tx('提问', 'Question'), 6000);
    question.input.rows = 2;
    const front = field(tx('正面', 'Front'), 18000);
    const back = field(tx('背面', 'Back'), 18000);
    const draft = () => ({type_id: type.value, front: front.input.value.trim(), back: back.input.value.trim()});
    let saveId = crypto.randomUUID(), lastSubmitted = null;
    const cards = create(doc, 'div', '', 'clipperCards');
    const note = result => {
      const card = create(doc, 'section', '', 'clipperMessage');
      card.append(renderText(doc, result));
      const cardActions = create(doc, 'div', '', 'clipperButtons');
      for (const [label, target] of [[tx('加入正面', 'Add to front'), front.input], [tx('加入背面', 'Add to back'), back.input]]) {
        cardActions.append(button(doc, label, () => {
          target.value = [target.value.trim(), result].filter(Boolean).join('\n\n').slice(0, target.maxLength);
        }, 'textButton'));
      }
      card.append(cardActions);
      messages.append(card);
    };
    const send = button(doc, tx('发送', 'Send'), () => void sendQuestion(), 'primaryButton');
    const fallback = tx('请解释所选内容。', 'Please explain the selection.');
    let quickPending = kind === 'ask';
    function sendQuestion() {
      const text = question.input.value.trim() || fallback;
      return run(send, async () => {
        const {text: answer} = await api({action: 'chat', type_id: type.value, text, turns: turns.slice(-20)});
        if (session.closed) return;
        turns.push({role: 'user', text}, {role: 'assistant', text: answer});
        messages.append(create(doc, 'p', text, 'clipperQuestion'));
        note(answer);
        if (question.input.value.trim() === text) question.input.value = '';
        status.textContent = '';
      }, tx('正在回答…', 'Waiting for an answer…'));
    }
    const compose = button(doc, tx('整合为卡片', 'Compose cards'), () => void run(compose, async () => {
      const current = draft();
      const result = await api({action: 'compose', type_id: type.value, turns: turns.slice(-20),
        draft: current.front || current.back ? {...current, front: current.front || source.text} : null,
        text: question.input.value.trim()});
      if (session.closed) return;
      cards.replaceChildren();
      for (const card of result.cards) {
        const row = create(doc, 'section', '', 'clipperMessage');
        row.append(renderText(doc, card.front), renderText(doc, card.back),
          button(doc, tx('使用这张草稿', 'Use this draft'), () => {
            const previous = draft();
            if ((previous.front || previous.back) && !host.ownerDocument.defaultView.confirm(
              tx('用生成结果替换当前编辑区里的草稿？', 'Replace the draft currently in the editor?'))) return;
            type.value = card.type_id;
            front.input.value = card.front;
            back.input.value = card.back;
          }));
        cards.append(row);
      }
      status.textContent = '';
    }, tx('正在整合卡片…', 'Composing cards…')));
    const saveCard = button(doc, tx('保存卡片', 'Save card'), () => void run(saveCard, async () => {
      const data = {...draft(), kind: 'card'};
      if (!data.front || !data.back) throw new Error(tx('请填写卡片正反面。', 'Enter both sides of the card.'));
      const signature = JSON.stringify([data, sourceData()]);
      if (lastSubmitted && lastSubmitted !== signature) saveId = crypto.randomUUID();
      lastSubmitted = signature;
      await save(saveId, data);
      if (!session.closed) status.textContent = saved();
    }, saving()), 'primaryButton');
    const copySelection = button(doc, tx('选区加入正面', 'Add selection to front'), () => {
      front.input.value = [front.input.value.trim(), source.text].filter(Boolean).join('\n\n').slice(0, front.input.maxLength);
    }, 'textButton');
    const chatActions = create(doc, 'div', '', 'clipperButtons');
    chatActions.append(send, compose);
    const saveActions = create(doc, 'div', '', 'clipperButtons');
    saveActions.append(saveCard, copySelection);
    const editor = create(doc, 'div', '', 'clipperEditor');
    editor.append(front.label, back.label, saveActions);
    panel.append(typeLabel, messages, question.label, chatActions, cards, editor);
    send.disabled = compose.disabled = saveCard.disabled = true;
    types ||= Promise.resolve(request('clipper/types')).catch(error => { types = null; throw error; });
    types.then(result => {
      if (session.closed) return;
      for (const choice of result.types) {
        const option = create(doc, 'option', choice.label);
        option.value = choice.id;
        type.append(option);
      }
      send.disabled = compose.disabled = saveCard.disabled = false;
      if (quickPending) { quickPending = false; void sendQuestion(); }
    }).catch(error => { if (!session.closed) status.textContent = error.message; });
  }

  window.addEventListener('pagehide', close);
  return {open, close};
}
