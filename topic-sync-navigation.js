import {getLanguage} from './i18n.js?v=74b96f499bbe2fdf';
import {installBodyEditor} from './topic-body-editor.js?v=74b96f499bbe2fdf';

const channel = 'graspmemoedu-remnote-v1';
const tr = (zh, en) => getLanguage() === 'en' ? en : zh;
const returning = document.querySelector('[data-topic-return]');
const download = document.querySelector('[data-navigator-download]');
if (download) download.addEventListener('click', async () => {
  const status = document.querySelector('[data-download-status]');
  download.disabled = true;
  status.textContent = '正在下载安装包…';
  try {
    const meta = await fetch(new URL('./deployment.json', import.meta.url), {cache:'no-store',redirect:'error'});
    if (!meta.ok) throw Error('无法读取网站配置。');
    const origin = (await meta.json()).api_origin || location.origin;
    if (origin !== 'https://124.221.144.155' && origin !== location.origin) throw Error('网站服务地址无效。');
    const token = localStorage.getItem('graspmemoedu:identity:' + origin);
    if (!token) throw Error('请先返回网站登录，再重新打开安装页。');
    const headers = {'X-Learning-Identity':token};
    if (origin === location.origin && location.protocol === 'http:') {
      const session = await fetch(new URL('/api/session', origin), {cache:'no-store'});
      if (session.ok) headers['X-Learning-Session'] = (await session.json()).session_token;
    }
    const response = await fetch(new URL('/api/topic-sync/installer/windows',origin), {headers,cache:'no-store',redirect:'error'});
    if (!response.ok) throw Error((await response.json()).detail?.message || '下载失败，请重新登录后重试。');
    const url=URL.createObjectURL(await response.blob());
    const link=document.createElement('a');
    link.href=url; link.download='GraspMemoEdu-RemNote-Windows-x64.zip';
    link.click();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    status.textContent='下载已就绪。解压后运行 Install.cmd。';
  } catch (error) { status.textContent=error.message; }
  finally { download.disabled=false; }
});
if (returning && /^#\/subjects\/[^/]+\/topic\/[A-Za-z0-9_.-]+(?:\?.*)?$/.test(location.hash)) {
  returning.href = './' + location.hash;
}

function companion(action, ticket) {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    function finish(error, value) {
      window.removeEventListener('message', receive);
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    }
    function receive(event) {
      const {data} = event;
      if (event.source !== window || event.origin !== location.origin || data?.channel !== channel ||
          data.type !== 'response' || data.id !== id) return;
      const result = data.result;
      if (!result || result.error) {
        const error = new Error(result?.error || tr('导航扩展暂未连接。', 'The navigation extension is offline.'));
        error.code = result?.code;
        finish(error);
      } else finish(null, result);
    }
    const timer = setTimeout(() => {
      const error = new Error(tr('未找到 RemNote 导航扩展。', 'The RemNote navigation extension was not found.'));
      error.code = 'navigator_missing';
      finish(error);
    }, action === 'device' ? 2400 : 21000);
    window.addEventListener('message', receive);
    window.postMessage({channel, type: 'request', id, action, ticket}, location.origin);
  });
}

export function remnoteTopicLink(hash) {
  const match = /^#\/remnote-topic\/([0-9a-f-]{36})\/([A-Za-z0-9_.-]{1,180})(?:\?.*)?$/i.exec(hash);
  return match ? {deviceId: match[1], topicId: match[2]} : null;
}

export function topicBindingPath(deviceId, topicId) {
  return 'topic-sync/binding?' + new URLSearchParams({device_id: deviceId, topic_id: topicId});
}

export function installTopicNavigation({target, request, current, apiOrigin}) {
  const area = document.createElement('section');
  area.className = 'lessonToolbar';
  area.hidden = true;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'textButton';
  const status = document.createElement('p');
  status.className = 'pauseHint';
  status.setAttribute('role', 'status');
  const edit = document.createElement('button');
  edit.type = 'button'; edit.className = 'textButton'; edit.hidden = true;
  const panel = document.createElement('section');
  panel.hidden = true;
  const editor = installBodyEditor({button: edit, panel, status, request, current, companion, apiOrigin});
  area.append(edit, button, status);
  target.after(area);
  area.after(panel);
  let key, generation = 0;

  async function refresh() {
    const scope = current();
    const next = scope ? JSON.stringify(scope) : null;
    if (next === key) return;
    key = next;
    const requestGeneration = ++generation;
    area.hidden = true;
    editor.reset();
    button.disabled = false;
    status.textContent = '';
    if (!scope) return;
    try {
      const state = await request('topic-sync/device-state', {fresh: true});
      if (generation === requestGeneration) {
        button.textContent = tr('在本地 RemNote 中打开', 'Open in local RemNote');
        area.hidden = false;
        if (state.editor) {
          try { await editor.open(scope); }
          catch (error) {
            if (generation !== requestGeneration) return;
            status.textContent = error.message;
            button.disabled = error.code === 'topic_sync_account_mismatch';
          }
        }
      }
    } catch {
      // Existing installations may run without the Topic sync service.
    }
  }

  button.addEventListener('click', async () => {
    const scope = current();
    if (!scope || key !== JSON.stringify(scope)) return;
    const requestGeneration = generation;
    const isCurrent = () => generation === requestGeneration && key === JSON.stringify(current());
    button.disabled = true;
    status.textContent = tr('正在连接本地 RemNote…', 'Connecting to local RemNote…');
    let mismatch = false;
    try {
      let device = await companion('device');
      if (!isCurrent()) return;
      let paired = false;
      if (device.device_id) {
        try {
          const state = await request('topic-sync/device-state?' + new URLSearchParams({device_id: device.device_id}), {fresh: true});
          paired = !state.reauthorize;
        } catch (error) {
          if (error.code !== 'topic_sync_device_unpaired') throw error;
        }
      }
      if (!paired) {
        const {ticket} = await request('topic-sync/pair-ticket', {method: 'POST', body: {}});
        if (!isCurrent()) return;
        device = await companion('pair', ticket);
      }
      if (!isCurrent()) return;
      const {ticket} = await request('topic-sync/open-ticket', {method: 'POST',
        body: {device_id: device.device_id, topic_id: scope.topicId}});
      if (!isCurrent()) return;
      const result = await companion('open', ticket);
      if (isCurrent() && result.status === 'opened') status.textContent = tr('已在 RemNote 中打开。', 'Opened in RemNote.');
    } catch (error) {
      if (!isCurrent()) return;
      mismatch = error.code === 'topic_sync_account_mismatch';
      if (error.code === 'navigator_missing') {
        const install = new URL('./remnote-install.html', import.meta.url);
        install.hash = location.hash.slice(1);
        location.assign(install);
      } else {
        status.textContent = error.message || tr('暂时无法打开 RemNote。', 'Could not open RemNote.');
      }
    } finally {
      if (isCurrent()) button.disabled = mismatch;
    }
  });
  return {refresh};
}
