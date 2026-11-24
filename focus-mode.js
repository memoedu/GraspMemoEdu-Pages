import {t} from './i18n.js?v=35eedf1f9f75af35';

export function focusReaderRoute({path, params}) {
  return /^\/(?:topic\/[^/]+|review\/[^/]+\/[^/]+)$/.test(path)
    || (/^\/banks\/[^/]+\/[^/]+$/.test(path) && params.get('review') !== '1' && params.get('card') !== '1');
}

export function createFocusMode({toolbar, toggle, fullscreen, fullscreenNotice, nextHref, locationChanged}) {
  let enabled = false, pending = null;
  let nativeActive = false, requesting = false, fullscreenFailed = false;
  const surface = document.documentElement;
  const canFullscreen = () => document.fullscreenEnabled && typeof surface.requestFullscreen === 'function';
  const render = () => {
    document.body.classList.toggle('learningFocus', enabled);
    toggle.textContent = t(enabled ? 'focus.exit' : 'focus.enter');
    toggle.setAttribute('aria-pressed', String(enabled));
    const hideFullscreen = !enabled || nativeActive || !canFullscreen();
    if (hideFullscreen && document.activeElement === fullscreen && !toolbar.hidden) toggle.focus({preventScroll: true});
    fullscreen.hidden = hideFullscreen;
    fullscreen.disabled = requesting;
    const message = !canFullscreen() ? t('focus.fullscreenUnavailable') : fullscreenFailed ? t('focus.fullscreenFailed') : '';
    if (fullscreenNotice.textContent !== message) fullscreenNotice.textContent = message;
    fullscreenNotice.hidden = !enabled || !message;
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
    const showNext = href => {
      if (href) next.href = readerHref(href);
      else next.removeAttribute('href');
      // Keep the return action if the learner has already tabbed to it.
      fallback.hidden = enabled && Boolean(href) && document.activeElement !== fallback;
      fallback.classList.toggle('primaryButton', enabled || !href);
      fallback.classList.toggle('secondaryButton', !enabled && Boolean(href));
      next.hidden = !href;
    };
    showNext(next.getAttribute('href'));
    retry.hidden = true;
    const request = pending ||= nextHref();
    const current = () => pending === request && action.isConnected;
    request.then(href => {
      if (current()) showNext(href);
    }, () => {
      if (!current()) return;
      showNext(null);
      retry.hidden = false;
    });
  }
  function setEnabled(active) {
    enabled = active;
    pending = null;
    fullscreenFailed = false;
    history.replaceState(history.state, '', readerHref(location.hash));
    locationChanged();
    render();
    syncActions();
  }
  function closeFullscreen() {
    if (nativeActive && document.fullscreenElement === surface) {
      void document.exitFullscreen().then(syncNativeFullscreen, () => {});
    }
  }
  function syncNativeFullscreen() {
    const active = document.fullscreenElement === surface;
    if (active === nativeActive) return;
    nativeActive = active;
    if (!active && enabled) setEnabled(false);
    else if (active && !enabled) closeFullscreen();
    else render();
  }
  async function openFullscreen() {
    if (!enabled || requesting || !canFullscreen() || document.fullscreenElement === surface) return;
    requesting = true;
    fullscreenFailed = false;
    render();
    try {
      await surface.requestFullscreen({navigationUI: 'hide'});
      syncNativeFullscreen();
    } catch {
      fullscreenFailed = enabled;
    } finally {
      requesting = false;
      render();
    }
  }
  document.addEventListener('fullscreenchange', syncNativeFullscreen, true);
  window.addEventListener('resize', syncNativeFullscreen);
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || !enabled || !(nativeActive || requesting)
        || document.querySelector('dialog[open]')) return;
    setEnabled(false);
    closeFullscreen();
  });
  toggle.addEventListener('click', () => {
    setEnabled(!enabled);
    if (enabled) void openFullscreen();
    else closeFullscreen();
  });
  fullscreen.addEventListener('click', openFullscreen);
  return {
    start(route) {
      pending = null;
      enabled = Boolean(route && focusReaderRoute(route) && route.params.get('focus') === '1');
      toolbar.hidden = true;
      if (!enabled) closeFullscreen();
      render();
    },
    show(visible) {
      toolbar.hidden = !visible;
      if (!visible) {
        enabled = false;
        closeFullscreen();
      }
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
