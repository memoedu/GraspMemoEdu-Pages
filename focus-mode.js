import {t} from './i18n.js?v=299527f404a0b784';

export function focusReaderRoute({path, params}) {
  return /^\/(?:topic\/[^/]+|review\/[^/]+\/[^/]+)$/.test(path)
    || (/^\/banks\/[^/]+\/[^/]+$/.test(path) && params.get('review') !== '1' && params.get('card') !== '1');
}

export function createFocusMode({toolbar, toggle, nextHref, locationChanged}) {
  let enabled = false, pending = null;
  const render = () => {
    document.body.classList.toggle('learningFocus', enabled);
    toggle.textContent = t(enabled ? 'focus.exit' : 'focus.enter');
    toggle.setAttribute('aria-pressed', String(enabled));
  };
  function readerHref(href, active = enabled) {
    const [path, search] = href.split('?');
    const params = new URLSearchParams(search);
    if (active) params.set('focus', '1');
    else params.delete('focus');
    return path + (params.size ? '?' + params : '');
  }
  function syncActions() {
    for (const action of document.querySelectorAll('.focusCompletion')) syncAction(action);
  }
  function syncAction(action) {
    if (action.closest('[hidden]')) return;
    const [fallback, next, retry] = action.children;
    if (!enabled) {
      fallback.hidden = false;
      next.hidden = retry.hidden = true;
      return;
    }
    const request = pending ||= nextHref();
    const current = () => enabled && pending === request && action.isConnected;
    request.then(href => {
      if (!current()) return;
      if (href) next.href = readerHref(href);
      // Keep the return action if the learner has already tabbed to it.
      fallback.hidden = Boolean(href) && document.activeElement !== fallback;
      next.hidden = !href;
      retry.hidden = true;
    }, () => { if (current()) retry.hidden = false; });
  }
  toggle.addEventListener('click', () => {
    enabled = !enabled;
    pending = null;
    history.replaceState(history.state, '', readerHref(location.hash));
    locationChanged();
    render();
    syncActions();
  });
  return {
    start(route) {
      pending = null;
      enabled = Boolean(route && focusReaderRoute(route) && route.params.get('focus') === '1');
      toolbar.hidden = true;
      render();
    },
    show(visible) {
      toolbar.hidden = !visible;
      if (!visible) enabled = false;
      render();
      if (visible) syncActions();
    },
    readerHref,
    completion(fallback) {
      const action = document.createElement('span');
      action.className = 'focusCompletion';
      const next = document.createElement('a');
      next.className = 'primaryButton';
      next.textContent = t('focus.next');
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'textButton';
      retry.textContent = t('focus.retry');
      retry.addEventListener('click', () => {
        retry.hidden = true;
        pending = null;
        syncAction(action);
      });
      next.hidden = retry.hidden = true;
      action.append(fallback, next, retry);
      queueMicrotask(() => { if (action.isConnected && !toolbar.hidden) syncAction(action); });
      return action;
    },
  };
}
