const imageType = types => [...types].find(type => type.startsWith('image/'));
const textTypes = {
  read: ['读', 'Read'], card: ['卡', 'Card'], excerpt: ['摘', 'Excerpt'], ask: ['问', 'Ask'],
};
const actions = {...textTypes, image: ['图', 'Images']};

async function clipboardMaterial(image) {
  if (!image) return (await navigator.clipboard.readText()).trim();
  for (const item of await navigator.clipboard.read()) {
    const type = imageType(item.types);
    if (type) {
      const blob = await item.getType(type);
      if (blob.size) return blob;
    }
  }
}

async function captureScreen(isCurrent) {
  const stream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: false});
  const video = document.createElement('video');
  try {
    if (!isCurrent()) return;
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  } finally {
    stream.getTracks().forEach(track => track.stop());
    video.srcObject = null;
  }
}

export function clipperAcquisition({label, text, onOpen, pageSource, externalSource}) {
  let attempt;
  const note = document.createElement('div');
  note.className = 'clipperCaptureHint';
  note.hidden = true;
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'textButton';
  note.append(status, cancel);
  document.body.append(note);
  const stop = () => {
    attempt?.abort();
    attempt = null;
    note.hidden = true;
  };
  cancel.addEventListener('click', stop);
  const message = value => {
    status.textContent = value;
    cancel.textContent = text('取消', 'Cancel');
    note.hidden = false;
  };
  function prompt(image, next, signal, origin) {
    const dialog = document.createElement('dialog');
    dialog.className = 'clipperCaptureDialog';
    dialog.setAttribute('data-no-tool-relocation', '');
    const description = document.createElement('p');
    description.id = 'clipper-capture-description';
    description.textContent = image
      ? text('剪贴板里没有可用的图片。继续可截图，也可以复制图片后粘贴，或点击本页图片。',
        'No usable image was found. Continue to take a screenshot, paste a copied image, or click an image on this page.')
      : text('剪贴板里没有可用的文字。继续后请在本页选择文字。',
        'No usable text was found. Continue to select text on this page.');
    dialog.setAttribute('aria-describedby', description.id);
    dialog.setAttribute('aria-label', label);
    const controls = document.createElement('div');
    controls.className = 'clipperCaptureControls';
    const accept = document.createElement('button'), dismiss = document.createElement('button');
    accept.type = dismiss.type = 'button';
    accept.className = 'primaryButton';
    dismiss.className = 'secondaryButton';
    accept.textContent = text('继续', 'Continue');
    dismiss.textContent = text('取消', 'Cancel');
    controls.append(dismiss, accept);
    dialog.append(description, controls);
    document.body.append(dialog);
    function close() {
      dialog.close();
      dialog.remove();
    }
    signal.addEventListener('abort', close, {once: true});
    dismiss.addEventListener('click', () => { stop(); origin.focus(); });
    dialog.addEventListener('cancel', event => { event.preventDefault(); stop(); origin.focus(); });
    accept.addEventListener('click', () => { close(); next(); });
    dialog.showModal();
  }

  async function start(id, origin) {
    stop();
    const controller = new AbortController();
    attempt = controller;
    const {signal} = controller;
    const image = id === 'image';
    const finish = source => {
      if (signal.aborted || !source) return;
      stop();
      void onOpen(id, source).catch(error => message(error.message));
    };
    let material;
    try { material = await clipboardMaterial(image); } catch { /* Browser permission or unsupported clipboard format. */ }
    if (signal.aborted) return;
    if (material) { finish(externalSource(material)); return; }
    prompt(image, () => {
      getSelection()?.removeAllRanges();
      const pick = event => {
        const source = pageSource(image, event.target);
        if (source) {
          if (image) { event.preventDefault(); event.stopImmediatePropagation(); }
          finish(source);
        }
      };
      document.addEventListener(image ? 'click' : 'pointerup', pick, {signal, capture: image});
      if (!image) document.addEventListener('keyup', pick, {signal});
      document.addEventListener('keydown', event => { if (event.key === 'Escape') stop(); }, {signal});
      if (!image) {
        message(text('请在当前页面拖动选中文字。', 'Drag to select text on this page.'));
        return;
      }
      document.addEventListener('paste', event => {
        const files = [...(event.clipboardData?.files || [])];
        const file = files.find(value => value.type.startsWith('image/'));
        if (file) { event.preventDefault(); finish(externalSource(file)); }
      }, {signal, capture: true});
      void captureScreen(() => !signal.aborted).then(blob => {
        if (blob) finish(externalSource(blob));
      }).catch(() => {}).finally(() => {
        if (!signal.aborted) message(text('可粘贴复制的图片，或点击本页图片。', 'Paste a copied image or click an image on this page.'));
      });
    }, signal, origin);
  }

  return {
    stop,
    get selecting() { return Boolean(attempt); },
    render(panel, hide, origin) {
      panel.replaceChildren(...Object.entries(actions).map(([id, names]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondaryButton';
        button.dataset.action = id;
        button.textContent = text(...names);
        button.addEventListener('click', () => { hide(); void start(id, origin); });
        return button;
      }));
    },
  };
}
