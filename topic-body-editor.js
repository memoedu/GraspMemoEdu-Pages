import {getLanguage} from './i18n.js?v=f81a576e90667aa8';

const say = (zh, en) => getLanguage() === 'en' ? en : zh;
const enabledKey = scope => 'graspmemoedu:topic-edit:' + scope;
const drafts = new Map();
const preferences = new Map();
const keyOf = document => JSON.stringify(document);

export function installBodyEditor({button, panel, status, request, current, companion, apiOrigin, installErrors}) {
  let active;
  const live = session => active === session && session.scopeKey === keyOf(current());
  function notice(session, text) { if (live(session)) status.textContent = text; }
  function remember(session) {
    if (session.pending) drafts.set(session.draftKey, {
      document: session.pending, revision: session.revision, baseline: session.baseline, official: session.official,
      attempt: session.attempt,
    });
    else drafts.delete(session.draftKey);
  }
  function hide(session) {
    clearTimeout(session.timer);
    clearTimeout(session.loadTimer);
    session.port?.close();
    session.port = null;
    session.ready = false;
    panel.replaceChildren();
    panel.hidden = true;
  }
  function reset() {
    if (active) {
      if (active.editable) remember(active);
      hide(active);
      active = null;
    }
    button.hidden = true;
  }
  function updateButton(session) {
    button.hidden = false;
    button.disabled = !session.editable;
    button.setAttribute('aria-pressed', String(session.editing));
    const label = session.editing ? say('关闭编辑', 'Finish editing') : say('开启编辑', 'Enable editing');
    button.setAttribute('aria-label', label);
    button.title = session.editable ? label : say('管理员尚未开放此 Topic 的编辑权限。', 'Editing is disabled by your administrator.');
  }
  function prefer(session, editing) {
    const key = enabledKey(session.draftKey);
    preferences.set(key, editing);
    try { localStorage.setItem(key, editing ? 'yes' : 'no'); } catch {}
  }
  function changed(session, document) {
    if (!live(session) || !session.editing || document?.format !== 'topic-outline-v1' || !Array.isArray(document.blocks)) return;
    if (keyOf(document) === keyOf(session.pending ?? session.saved)) return;
    session.pending = document;
    remember(session);
    clearTimeout(session.timer);
    if (!session.blocked) session.timer = setTimeout(() => save(session).catch(() => {}), 550);
  }
  async function save(session) {
    if (session.saving) return session.saving;
    if (!live(session) || !session.pending || session.blocked) return;
    session.saving = (async () => {
      while (live(session) && session.pending) {
        // Reuse an ambiguous attempt after a network failure, including when the learner typed further.
        session.attempt ??= {revision: crypto.randomUUID(), document: session.pending};
        const attempt = session.attempt;
        remember(session);
        notice(session, say('正在保存…', 'Saving…'));
        try {
          await request('topic-sync/body' + session.deviceQuery, {method: 'POST', body: {
            topic_id: session.scope.topicId, revision: attempt.revision, expected_revision: session.revision,
            expected_baseline_revision: session.baseline, expected_official_version: session.official,
            document: attempt.document,
          }});
        } catch (error) {
          if (live(session)) {
            session.blocked = ['topic_sync_stale_revision', 'topic_sync_revision_reused', 'topic_sync_baseline_changed',
              'topic_sync_account_mismatch', 'topic_sync_edit_disabled'].includes(error.code) || error.status === 409;
            notice(session, error.message);
            session.retry.hidden = session.blocked;
          }
          throw error;
        }
        session.revision = attempt.revision;
        session.official = null;
        session.saved = attempt.document;
        session.attempt = null;
        if (keyOf(session.pending) === keyOf(attempt.document)) session.pending = null;
        if (!active || active === session || active.draftKey !== session.draftKey) remember(session);
      }
      if (live(session)) {
        session.retry.hidden = true;
        notice(session, say('正文已保存。', 'Changes saved.'));
      }
    })().finally(() => { session.saving = null; });
    return session.saving;
  }

  function show(session, document) {
    const frame = window.document.createElement('iframe');
    frame.className = 'topicBodyFrame';
    frame.title = say('Topic 大纲正文', 'Topic outline');
    frame.sandbox = 'allow-scripts allow-same-origin allow-downloads';
    const url = new URL('/topic-editor/', apiOrigin());
    frame.src = url.href;
    const {port1, port2} = new MessageChannel();
    session.port?.close();
    session.port = port1;
    const retry = window.document.createElement('button');
    retry.type = 'button'; retry.className = 'textButton'; retry.hidden = true;
    retry.textContent = say('重试保存', 'Retry saving');
    retry.onclick = () => save(session).catch(() => {});
    session.retry = retry;
    port1.onmessage = ({data}) => {
      if (!live(session) || session.port !== port1) return;
      if (data?.type === 'loaded' || data?.type === 'error') {
        clearTimeout(session.loadTimer);
        session.ready = data.type === 'loaded';
        notice(session, session.ready ? '' : say('编辑器载入失败。', 'Could not load the editor.'));
      } else if (data?.type === 'change') changed(session, data.document);
      else if (data?.type === 'flushed' && session.flush?.id === data.id) {
        changed(session, data.document);
        session.flush.done();
      }
    };
    frame.addEventListener('load', () => {
      if (live(session)) frame.contentWindow.postMessage({channel: 'graspmemoedu-tine-v1', document,
        editable: session.editing}, url.origin, [port2]);
    }, {once: true});
    session.ready = false;
    clearTimeout(session.loadTimer);
    session.loadTimer = setTimeout(() => notice(session, say('编辑器载入超时，请重新打开。', 'Editor timed out. Reopen it.')), 15000);
    panel.replaceChildren(frame, retry);
    panel.hidden = false;
  }

  async function open(scope, previous = null) {
    reset();
    const session = {scope, scopeKey: keyOf(scope), draftKey: keyOf([apiOrigin(), scope.learnerId, scope.topicId]),
      deviceQuery: '', editing: false, pending: null, attempt: null};
    active = session;
    let state;
    try {
      let device;
      try { device = await companion('device'); }
      catch (error) { if (!installErrors.has(error.code)) throw error; }
      if (!live(session)) return;
      if (device?.device_id) session.deviceQuery = '?' + new URLSearchParams({device_id: device.device_id});
      const query = new URLSearchParams(session.deviceQuery);
      query.set('topic_id', scope.topicId);
      state = await request('topic-sync/body?' + query, {fresh: true});
    } catch (error) {
      if (!previous) throw error;
      if (live(session)) {
        active = previous;
        updateButton(previous);
        notice(previous, error.message);
      }
      return;
    }
    if (!live(session)) return;
    Object.assign(session, {saved: state.document, revision: state.revision, baseline: state.baseline_revision,
      official: state.official_version, editable: state.editable});
    const preference = enabledKey(session.draftKey);
    let preferred = preferences.get(preference);
    try {
      const stored = localStorage.getItem(preference);
      if (stored !== null) preferred = stored === 'yes';
    } catch {}
    session.editing = Boolean((previous || preferred) && state.editable);
    if (previous && session.editing) prefer(session, true);
    const draft = drafts.get(session.draftKey);
    if (draft && state.editable) {
      if (draft.attempt?.revision === state.revision && keyOf(draft.attempt.document) === keyOf(state.document)) {
        session.pending = keyOf(draft.document) === keyOf(state.document) ? null : draft.document;
      } else {
        session.pending = draft.document;
        session.attempt = draft.attempt;
        session.blocked = state.revision !== draft.revision || (!state.revision &&
          (state.baseline_revision !== draft.baseline || state.official_version !== draft.official));
        if (session.blocked) Object.assign(session, {
          revision: draft.revision, baseline: draft.baseline, official: draft.official,
        });
      }
    }
    updateButton(session);
    if (!session.editing) {
      if (!state.editable && (state.revision || state.baseline_revision)) show(session, session.saved);
      return;
    }
    show(session, session.pending ?? session.saved);
    if (session.pending && !session.blocked) void save(session).catch(() => {});
    if (session.blocked) notice(session, say('正文已有新版本，此页保留了未保存的改动。', 'A newer revision exists. Your draft is still here.'));
  }

  button.addEventListener('click', async () => {
    const session = active;
    if (!session || !live(session) || !session.editable) return;
    button.disabled = true;
    try {
      if (session.editing && session.ready) {
        await new Promise((resolve, reject) => {
          const id = crypto.randomUUID();
          const timer = setTimeout(() => {
            session.flush = null;
            reject(Error(say('编辑器未确认保存。', 'The editor did not acknowledge the save.')));
          }, 5000);
          session.flush = {id, done: () => { clearTimeout(timer); session.flush = null; resolve(); }};
          session.port.postMessage({type: 'flush', id});
        });
        if (!live(session)) return;
      }
      if (!live(session)) return;
      if (session.editing) {
        if (!session.blocked) await save(session);
        if (!live(session)) return;
        prefer(session, false);
        session.editing = false;
        hide(session);
        updateButton(session);
        return;
      }
      await open(session.scope, session);
      if (active?.editing && live(active)) panel.scrollIntoView({block: 'nearest'});
    } catch (error) { notice(session, error.message); }
    finally { if (live(session) && session.editable) button.disabled = false; }
  });
  return {open, reset};
}
