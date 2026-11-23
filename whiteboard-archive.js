const dbName = 'graspmemoedu-whiteboard';
const folderKey = 'directory';

function directoryHandle(value) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(dbName, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('settings');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction('settings', value ? 'readwrite' : 'readonly');
      const settings = transaction.objectStore('settings');
      const action = value ? settings.put(value, folderKey) : settings.get(folderKey);
      transaction.oncomplete = () => { db.close(); resolve(action.result); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  });
}

export async function chooseWhiteboardFolder() {
  if (!window.showDirectoryPicker) throw Error('directory_unsupported');
  const root = await window.showDirectoryPicker({id: 'graspmemoedu-whiteboard', mode: 'readwrite'});
  await directoryHandle(root);
  return root;
}

export async function whiteboardFolder({readOnly = false, ask = false} = {}) {
  const root = await directoryHandle();
  if (!root) return null;
  const descriptor = {mode: readOnly ? 'read' : 'readwrite'};
  let permission = await root.queryPermission(descriptor);
  if (ask && permission === 'prompt') permission = await root.requestPermission(descriptor);
  return permission === 'granted' ? root : null;
}

async function questionFolder(root, key, create) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const id = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
  const archive = await root.getDirectoryHandle('GraspMemoEdu-Whiteboards', {create});
  return archive.getDirectoryHandle(id, {create});
}

async function write(root, name, data) {
  const file = await root.getFileHandle(name, {create: true});
  const stream = await file.createWritable();
  try {
    await stream.write(data);
    await stream.close();
  } catch (error) {
    try { await stream.abort(); } catch {}
    throw error;
  }
}

export async function saveWhiteboard(root, key, snapshot, registers) {
  const question = await questionFolder(root, key, true);
  const image = `${new Date().toISOString().replaceAll(':', '-')}-${crypto.randomUUID()}.png`;
  await write(question, image, snapshot.png);
  await write(question, 'latest.json', JSON.stringify({image, scene: snapshot.scene, registers: [...registers]}));
}

export async function restoreWhiteboard(root, key) {
  try {
    const question = await questionFolder(root, key, false);
    const file = await (await question.getFileHandle('latest.json')).getFile();
    if (file.size > 24_000_000) throw Error('archive_too_large');
    const saved = JSON.parse(await file.text());
    if (!/^[0-9TZ.-]+-[\da-f-]{36}\.png$/i.test(saved.image || '')) throw Error('invalid_archive');
    try {
      await (await question.getFileHandle(saved.image)).getFile();
      return saved;
    } catch (error) {
      if (error.name === 'NotFoundError') return {...saved, imageMissing: true};
      throw error;
    }
  } catch (error) {
    if (error.name === 'NotFoundError') return null;
    throw error;
  }
}
