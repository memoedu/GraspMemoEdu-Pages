import {getLanguage} from './i18n.js?v=32ec15b952d98758';
import {calculatorToolGroups} from './calculator.js?v=32ec15b952d98758';
import {voiceControls} from './voice-input.js?v=32ec15b952d98758';

const toolbars = new WeakMap();
const svgNamespace = 'http://www.w3.org/2000/svg';

function icon(path) {
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS(svgNamespace, 'path');
  line.setAttribute('d', path);
  svg.append(line);
  return svg;
}

export function setQuestionTools(anchor, question) {
  toolbars.get(anchor)?.remove();
  toolbars.delete(anchor);
  if (!anchor.parentNode || !question) return;
  const english = getLanguage() === 'en';
  const groups = calculatorToolGroups(question.calculate, english);
  if (!groups.length) return;
  const rail = document.createElement('aside');
  rail.className = 'questionToolRail';
  rail.setAttribute('aria-label', english ? 'Tools for this question' : '当前题目的工具');
  const row = document.createElement('div');
  row.className = 'questionToolRow';
  const toolbar = document.createElement('div');
  toolbar.className = 'questionTools';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', english ? 'Question tools' : '题目工具');
  toolbar.setAttribute('aria-orientation', 'vertical');
  const groupList = document.createElement('div');
  groupList.className = 'questionToolGroups';
  const message = document.createElement('div');
  message.className = 'questionToolStatus';
  message.setAttribute('role', 'status');
  const makeButton = ({id, label, icon: path, open}) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.tabIndex = -1;
    button.className = 'questionToolButton calculatorLaunch';
    button.dataset.questionTool = id;
    button.dataset.readOnly = 'true';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    button.append(icon(path));
    button.addEventListener('click', async () => {
      if (button.hasAttribute('aria-busy')) return;
      button.setAttribute('aria-busy', 'true');
      message.textContent = '';
      try {
        await open(button);
      } catch {
        if (button.isConnected) message.textContent = english ? 'Tool couldn’t load. Select it again to retry.' : '工具加载失败，请再次点击重试。';
      } finally {
        button.removeAttribute('aria-busy');
      }
    });
    return button;
  };
  const buttons = [];
  for (const {label, tools} of groups) {
    const group = document.createElement('div');
    group.className = 'questionToolGroup';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    const controls = tools.map(makeButton);
    group.append(...controls);
    groupList.append(group);
    buttons.push(...controls);
  }
  buttons[0].tabIndex = 0;
  toolbar.addEventListener('focusin', event => {
    if (buttons.includes(event.target)) for (const button of buttons) button.tabIndex = button === event.target ? 0 : -1;
  });
  toolbar.addEventListener('keydown', event => {
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
  toolbar.append(groupList, voiceControls());
  row.append(toolbar, message);
  rail.append(row);
  if (!anchor.parentElement?.classList.contains('questionWorkspace')) {
    const workspace = document.createElement('div');
    workspace.className = 'questionWorkspace';
    anchor.before(workspace);
    workspace.append(anchor);
  }
  anchor.after(rail);
  toolbars.set(anchor, rail);
}
