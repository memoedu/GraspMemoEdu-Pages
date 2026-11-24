import {getLanguage} from './i18n.js?v=dc07b85c3eb4a143';

// The distribution contains the same Workflow assembly and chat editor shipped to WebView2.
const base=new URL('./vendor/knowledge-clipper/',import.meta.url);
const frameUrl=new URL('index.html',base);
let activeAudio, audioOwner, latestPlayback=0;
let rules;
const tx=(zh,en)=>getLanguage()==='en'?en:zh;
function stopAudio(){activeAudio?.pause();if(activeAudio?.src)URL.revokeObjectURL(activeAudio.src);activeAudio=null;}
async function archive(owner){const {localArchive}=await import(new URL('storage.js',base));return localArchive(owner);}
async function play(owner,key,enabled=true){
  const db=await archive(owner);
  try{
    const data=await db.get('recordings',key);
    if(!data)throw new Error(tx('原录音已不可用。','The original recording is unavailable.'));
    await db.put('meta','lastRecording',key);
    if(enabled){
      const {blobFrom}=await import(new URL('storage.js',base));stopAudio();audioOwner=owner;
      const audio=new Audio(URL.createObjectURL(blobFrom(data.data,data.mime)));activeAudio=audio;
      try {await audio.play();}catch{throw new Error(tx('浏览器暂停了播放，可点「播放原录音」。','Press Play recording to start audio.'));}
    }
    return true;
  }finally{db.close();}
}
export async function replayRecording(owner){
  if(!owner)return;
  const db=await archive(owner);
  try{const key=await db.get('meta','lastRecording');if(key)await play(owner,key);}
  finally{db.close();}
}
async function collect(source){
  const {encoded}=await import(new URL('storage.js',base));
  const images=await Promise.all((source.assets||[]).map(async img=>{
    if(!img.complete)await img.decode();
    if(!img.naturalWidth||img.naturalWidth*img.naturalHeight>24000000)throw new Error(tx('图片无法读取或尺寸过大。','Image unavailable or too large.'));
    const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
    canvas.getContext('2d').drawImage(img,0,0);
    let blob;
    try{blob=await new Promise((ok,fail)=>canvas.toBlob(v=>v?ok(v):fail(),'image/png'));}
    catch{throw new Error(tx('当前图片来源不允许读取。可选择本地图片继续。','This image cannot be read. Choose a local image to continue.'));}
    const digest=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
    return {data:await encoded(blob),role:'question',hash:[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('')};
  }));
  const resolve=value=>(value||'').replace(/\(clipper-image:(\d+)\)/g,(all,id)=>images[id]?'(asset:'+images[id].hash+')':all);
  return {images,source:{title:source.title,route:source.route,text:resolve(source.text),prefix:resolve(source.prefix),suffix:resolve(source.suffix),isImage:source.isImage}};
}
export async function mountFloating(session,{request,identity,preferences,language}){
  const owner=identity(), epoch=session.kind==='read'?++latestPlayback:latestPlayback;
  const live=()=>!!owner&&identity()===owner&&!session.closed;
  const ruleRequest=rules||=request('clipper/rules').catch(e=>{rules=null;throw e;});
  const [prefs,defaults,material]=await Promise.all([preferences(),ruleRequest,collect(session.source)]);
  if(!live())return;
  const doc=session.panel.ownerDocument, frame=doc.createElement('iframe');
  frame.title=tx('零碎知识简藏操作页','Knowledge Clipper workspace');
  frame.className='clipperFeatureFrame';frame.allow='clipboard-read; clipboard-write; autoplay';frame.src=frameUrl;
  let channel,savedId=null,source=material.source;
  session.pause=()=>{if(audioOwner===owner)stopAudio();};
  session.dispose=()=>{session.pause();channel?.close();};
  const operation=async(name,data)=>{
    if(!live())throw new Error(tx('账号已切换。','Your account changed.'));
    if(name==='play')return epoch<latestPlayback?false:play(owner,data.key,data.play);
    if(name==='settings'){window.location.hash='#/settings/knowledge-clipper';return true;}
    if(name==='checkpoint'){savedId=data;return true;}
    if(name==='resume'){savedId=data.id;source=data.source;frame.src=frameUrl;return true;}
    if(name==='save'){
      const origin={text:source.text.slice(0,18000),context:(data.context||'').slice(0,18000),title:source.title,route:source.route};
      const {context,...item}=data;
      await request('clipper/items',{method:'POST',body:{...item,source:origin},timeout:90000});
      return true;
    }
    if(name==='reference')return request('clipper/reference',{method:'POST',body:{url:data},timeout:14000});
    if(!['model','ocr','speech'].includes(name))throw new Error('Unsupported clipper operation');
    const seconds=name==='ocr'?prefs.values.mineruTimeoutSeconds:prefs.values.contentTimeoutSeconds;
    return request('clipper/workflow',{method:'POST',body:{operation:name,input:data},timeout:seconds*1000+5000});
  };
  frame.addEventListener('load',()=>{
    if(!live())return;
    channel?.close();const pair=new MessageChannel();const port=pair.port1;channel=port;
    port.onmessage=async({data})=>{
      if(!live()||!data||typeof data.id!=='number')return;
      try{const result=await operation(data.op,data.input);if(live())port.postMessage({id:data.id,result});}
      catch(e){if(live())port.postMessage({id:data.id,error:e.message});}
    };
    frame.contentWindow.postMessage({kind:'knowledge-clipper:open',owner,language:language(),images:savedId?[]:material.images,
      options:{action:session.kind,source,values:session.source.originalExcerpt?{...prefs.values,quickExcerpt:true}:prefs.values,
        model:prefs.model,imageModel:prefs.imageModel,defaults:defaults.rules,overrides:prefs.rules,savedId}},
      frameUrl.origin,[pair.port2]);
  });
  session.panel.append(frame);
}
