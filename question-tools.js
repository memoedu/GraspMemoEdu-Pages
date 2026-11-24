import {setVoiceContext} from './voice-context.js?v=512895d8baae36be';
import {getLanguage} from './i18n.js?v=512895d8baae36be';
import {calculatorToolGroups} from './calculator.js?v=512895d8baae36be';
import {configureWhiteboard, openWhiteboard, prepareWhiteboard, questionToolSession} from './whiteboard.js?v=512895d8baae36be';
import {questionWhiteboard} from './whiteboard-answer.js?v=512895d8baae36be';

const toolbars = new WeakMap();
const svgNamespace = 'http://www.w3.org/2000/svg';

const modalSelector = globalThis.CSS?.supports?.('selector(dialog:modal)') ? 'dialog:modal' : 'dialog[open]';

export function currentModal() {
  const dialogs = document.querySelectorAll(modalSelector);
  return dialogs[dialogs.length - 1];
}

function icon(path) {
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS(svgNamespace, 'path');
  line.setAttribute('d', path);
  svg.append(line);
  return svg;
}

function toolbarButtons(toolbar) {
  return [...toolbar.querySelectorAll('.questionToolButton')].filter(button => !button.closest('[hidden]'));
}

function setTabStop(toolbar, selected) {
  const buttons = toolbarButtons(toolbar);
  const active = selected || buttons.find(button => button.tabIndex === 0) || buttons[0];
  for (const button of buttons) button.tabIndex = button === active ? 0 : -1;
}

function createToolbar(label, orientation) {
  const toolbar = document.createElement('div');
  toolbar.className = 'questionTools';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', label);
  toolbar.setAttribute('aria-orientation', orientation);
  const marker = icon('M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z');
  marker.classList.add('toolbarMarker');
  toolbar.append(marker);
  toolbar.addEventListener('focusin', event => {
    if (event.target.matches('.questionToolButton')) setTabStop(toolbar, event.target);
  });
  toolbar.addEventListener('keydown', event => {
    const buttons = toolbarButtons(toolbar);
    const index = buttons.indexOf(event.target);
    if (index < 0) return;
    const destination = {
      ArrowLeft: (index + buttons.length - 1) % buttons.length,
      ArrowUp: (index + buttons.length - 1) % buttons.length,
      ArrowRight: (index + 1) % buttons.length,
      ArrowDown: (index + 1) % buttons.length,
      Home: 0,
      End: buttons.length - 1,
    }[event.key];
    if (typeof destination !== 'number') return;
    event.preventDefault();
    buttons[destination].focus();
  });
  return toolbar;
}

function whiteboardTool(workspace, question, options, session, english) {
  return {id: 'whiteboard', label: english ? 'Whiteboard' : '白板', icon: 'M3 3h18v15H3zM7 14l5-6 4 3M9 21h6',
    open: button => openWhiteboard(workspace(), button, question, options, session, english)};
}

function toolButton({id, label, icon: path, open}, message, english, expanded = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.tabIndex = -1;
  button.className = 'questionToolButton calculatorLaunch';
  button.dataset.questionTool = id;
  button.dataset.readOnly = 'true';
  button.title = label;
  button.setAttribute('aria-label', label);
  if (id !== 'whiteboard') button.setAttribute('aria-haspopup', 'dialog');
  else if (expanded) button.setAttribute('data-whiteboard-launch', '');
  button.setAttribute('aria-expanded', String(expanded));
  button.append(icon(path));
  button.addEventListener('click', () => {
    message.textContent = '';
    try { open(button); }
    catch {
      message.textContent = english ? 'Tool couldn’t open. Select it again to retry.' : '工具未能打开，请再次点击重试。';
    }
  });
  return button;
}

export function installToolbars(host, voice, clipper) {
  const label = () => getLanguage() === 'en' ? 'Input tools' : '输入工具';
  const pageToolbar = createToolbar(label(), 'horizontal');
  host.append(pageToolbar);
  let modalToolbar;
  const sync = () => {
    const modal = voice.hidden ? null : currentModal();
    if (modalToolbar && modalToolbar.parentElement !== modal) {
      modalToolbar.remove();
      modalToolbar = null;
    }
    if (modal && !modalToolbar) {
      modalToolbar = createToolbar(label(), 'horizontal');
      modalToolbar.classList.add('dialogTools');
      modal.prepend(modalToolbar);
    }
    const hasPageTools = !voice.hidden || Boolean(clipper && !clipper.hidden);
    const questionToolbar = !hasPageTools ? null :
      [...document.querySelectorAll('.questionToolRail .questionTools')].find(toolbar => toolbar.getClientRects().length);
    const toolbar = modalToolbar || questionToolbar || pageToolbar;
    const hidePageTools = !hasPageTools || toolbar !== pageToolbar;
    if (host.hidden !== hidePageTools) host.hidden = hidePageTools;
    for (const button of [voice, clipper].filter(Boolean)) {
      if (button.parentElement === toolbar) continue;
      const previous = button.parentElement;
      toolbar.append(button);
      if (previous) setTabStop(previous);
      setTabStop(toolbar);
    }
    if (pageToolbar.getAttribute('aria-label') !== label()) pageToolbar.setAttribute('aria-label', label());
    if (modalToolbar && modalToolbar.getAttribute('aria-label') !== label()) modalToolbar.setAttribute('aria-label', label());
  };
  sync();
  // Route changes can replace a question rail or open a native modal.
  // Always transfer the one voice control to the currently usable toolbar.
  const observer = new MutationObserver(sync);
  observer.observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'hidden'],
  });
  observer.observe(document.documentElement, {attributes: true, attributeFilter: ['lang']});
}

export function setQuestionTools(anchor, question, whiteboard, topicBody) {
  toolbars.get(anchor)?.remove();
  toolbars.delete(anchor);
  const language = getLanguage();
  const reading = topicBody && !question?.question_id && !question?.card_id && !question?.interaction &&
    !['question', 'example', 'practice'].includes(question?.kind);
  if (topicBody) {
    if (reading) question = {...question, calculate: question?.calculate ?? {level: 'scientific'}};
    whiteboard ||= questionWhiteboard({...topicBody, key: JSON.stringify([topicBody.key, question.calculate]),
      language, question: {}, editable: true, canSubmit: false});
  }
  configureWhiteboard(anchor.parentElement, whiteboard);
  if (!anchor.parentNode || !question) return;
  const english = language === 'en';
  const session = questionToolSession(whiteboard?.key);
  const groups = calculatorToolGroups(question.calculate, english, session);
  if (whiteboard) {
    const tool = whiteboardTool(() => anchor.parentElement, question, whiteboard, session, english);
    groups.unshift({label: tool.label, tools: [tool]});
  }
  if (!groups.length) return;
  const rail = document.createElement('aside');
  rail.className = 'questionToolRail';
  rail.setAttribute('aria-label', reading ? (english ? 'Topic tools' : 'Topic 正文工具') : (english ? 'Tools for this question' : '当前题目的工具'));
  const row = document.createElement('div');
  row.className = 'questionToolRow';
  const toolbar = createToolbar(reading ? (english ? 'Topic tools' : '正文工具') : (english ? 'Question tools' : '题目工具'), 'vertical');
  const groupList = document.createElement('div');
  groupList.className = 'questionToolGroups';
  const message = document.createElement('div');
  message.className = 'questionToolStatus';
  message.setAttribute('role', 'status');
  for (const {label, tools} of groups) {
    const group = document.createElement('div');
    group.className = 'questionToolGroup';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    const controls = tools.map(tool => toolButton(tool, message, english,
      tool.id === 'whiteboard' && anchor.parentElement?.classList.contains('whiteboardOpen')));
    group.append(...controls);
    groupList.append(group);
  }
  toolbar.append(groupList);
  setTabStop(toolbar);
  row.append(toolbar, message);
  rail.append(row);
  if (!anchor.parentElement?.classList.contains('questionWorkspace')) {
    const workspace = document.createElement('div');
    workspace.className = 'questionWorkspace';
    anchor.before(workspace);
    workspace.append(anchor);
  }
  anchor.after(rail);
  setVoiceContext(anchor.parentElement, question);
  toolbars.set(anchor, rail);
  const launcher = toolbar.querySelector('[data-question-tool=whiteboard]');
  if (launcher) {
    const prepare = priority => prepareWhiteboard(anchor.parentElement, launcher, question, whiteboard, session, english, priority);
    requestAnimationFrame(() => { if (launcher.getClientRects().length) prepare(false); });
    launcher.addEventListener('pointerenter', () => prepare(true), {once: true});
    launcher.addEventListener('focus', () => prepare(true), {once: true});
  }
}
