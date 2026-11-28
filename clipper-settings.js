import {clipText as tx,clipperEnabled,setClipperEnabled} from './clipper.js?v=62993fabc4b9bca0';

const groups={
  floating:['浮点操作','Selection menu'],capture:['语言与上下文','Language and context'],images:['图片与识别','Images and OCR'],
  speech:['朗读','Read aloud'],shortcuts:['快捷键','Keyboard shortcuts'],model:['模型请求','Model requests']
};
export async function clipperSettings({request,node,current,owner}){
  const prefs=await request('clipper/settings');
  if(!current())return null;
  const page=node('section','settingsPage'), form=node('form','profileForm clipperSettings');
  const back=node('a','textButton',tx('返回设置','Back to settings'));back.href='#/settings';
  page.append(back,node('h1','portalPageTitle',tx('零碎知识简藏','Knowledge Clipper')),form);
  const status=node('p','profileStatus');status.setAttribute('role','status');
  const controls=new Map(), services=new Map(), editedRules={...prefs.rules};
  const field=(parent,label,el)=>{const wrapper=node('label','clipperSetting');wrapper.append(document.createTextNode(label),el);parent.append(wrapper);};
  const option=(select,value,label)=>{const el=node('option','',label);el.value=value;select.append(el);};
  const button=(label,handler)=>{const el=node('button','textButton',label);el.type='button';el.addEventListener('click',handler);return el;};
  for(const [group,labels] of Object.entries(groups)){
    const block=node('fieldset','autocompleteSetting');block.append(node('legend','',tx(...labels)));
    if(group==='floating'){
      const toggle=node('input');toggle.type='checkbox';toggle.checked=clipperEnabled(owner);
      toggle.onchange=()=>{if(current())setClipperEnabled(owner,toggle.checked);};
      const update=()=>{if(toggle.isConnected)toggle.checked=clipperEnabled(owner);else detach();};
      const detach=()=>{window.removeEventListener('clipper-toggle',update);window.removeEventListener('storage',update);};
      window.addEventListener('clipper-toggle',update);window.addEventListener('storage',update);
      window.addEventListener('hashchange',detach,{once:true});
      field(block,tx('在此浏览器启用选区工具','Enable the selection tool in this browser'),toggle);
    }
    for(const f of prefs.workflow.fields.filter(f=>f.group===group)){
      const tri=f.key==='originalImageMode';
      const el=node(f.kind==='choice'||tri?'select':'input');el.name=f.key;
      if(f.kind==='choice'){for(const c of f.choices)option(el,c.value,tx(c.label,c.english));el.value=prefs.values[f.key];}
      else if(tri){option(el,'ask',tx('每次选择','Ask each time'));option(el,'yes',tx('保留原图','Original images'));option(el,'no',tx('识别为文字','OCR text'));
        el.value=prefs.values[f.key]==null?'ask':prefs.values[f.key]?'yes':'no';}
      else if(f.kind==='boolean'){el.type='checkbox';el.checked=!!prefs.values[f.key];}
      else {el.type=f.kind==='number'?'number':'text';el.value=prefs.values[f.key];el.required=f.group!=='shortcuts';
        if(f.minimum!=null)el.min=f.minimum;if(f.maximum!=null)el.max=f.maximum;}
      field(block,tx(f.label,f.english),el);controls.set(f.key,[f,el]);
    }
    form.append(block);
  }
  for(const [service,zh,en] of [['model','内容模型','Content model'],['speech','语音合成','Speech synthesis'],['ocr','图片识别','Image recognition']]){
    const block=node('fieldset','autocompleteSetting');
    const old=prefs.bindings[service]||{};
    block.append(node('legend','',tx(zh,en)));
    const mode=node('select');option(mode,'site',tx('站点服务','Site service'));option(mode,'own',tx('我的服务','My service'));
    if(old.bound)option(mode,'remove',tx('解除绑定','Remove binding'));mode.value=old.active?'own':'site';
    const custom=node('div'), endpoint=node('input'), model=node('input'), secret=node('input');
    endpoint.type='url';endpoint.value=old.endpoint||'';endpoint.placeholder='https://…/v1';model.value=old.model||'';
    secret.type='password';secret.autocomplete='new-password';
    field(block,tx('使用服务','Service'),mode);
    field(custom,tx('API 基址','API base URL'),endpoint);field(custom,tx('模型名称','Model name'),model);
    field(custom,old.bound?tx('更换凭据','Replace credential'):tx('绑定凭据','Credential'),secret);block.append(custom);
    if(old.bound)block.append(node('p','fieldHint',tx('此账号已绑定凭据。','This account has a bound credential.')));
    const refresh=()=>{custom.hidden=mode.value!=='own';endpoint.required=model.required=!custom.hidden;
      secret.required=!custom.hidden&&(!old.bound||old.endpoint!==endpoint.value.trim().replace(/\/$/,''));};
    mode.onchange=endpoint.oninput=refresh;refresh();form.append(block);services.set(service,{mode,old,endpoint,model,secret});
  }
  const rules=node('details','autocompleteSetting'),summary=node('summary','',tx('提示词、问题类型与模式','Prompts, question types and modes'));
  rules.append(summary);form.append(rules);
  let loaded=false;
  rules.ontoggle=async()=>{
    if(!rules.open||loaded)return;loaded=true;
    try{
      const {rules:defaults}=await request('clipper/rules');if(!current())return;
      const select=node('select'), editor=node('textarea');editor.rows=12;editor.spellcheck=false;editor.dir='auto';
      for(const name of Object.keys(defaults).sort())option(select,name,name);
      select.value='lookup-meaning.md';const read=()=>{editor.value=editedRules[select.value]??defaults[select.value];};
      select.onchange=read;editor.oninput=()=>{if(editor.value===defaults[select.value])delete editedRules[select.value];else editedRules[select.value]=editor.value;};
      read();field(rules,tx('规则文件','Rule file'),select);field(rules,tx('生效内容','Effective text'),editor);
      rules.append(button(tx('恢复此项默认值','Restore this default'),()=>{delete editedRules[select.value];read();}));
    }catch(e){loaded=false;status.textContent=e.message;}
  };
  const save=node('button','primaryButton',tx('保存设置','Save settings'));save.type='submit';form.append(status,save);
  form.onsubmit=async event=>{
    event.preventDefault();if(!form.reportValidity())return;save.disabled=true;status.textContent='';
    const values=Object.fromEntries([...controls].map(([key,[f,el]])=>[key,key==='originalImageMode'?
      (el.value==='ask'?null:el.value==='yes'):f.kind==='boolean'?el.checked:f.kind==='number'?el.valueAsNumber:el.value]));
    const bindings=[];
    for(const [service,{mode,old,endpoint,model,secret}] of services){
      if(mode.value==='site'&&!old.active)continue;
      if(mode.value==='own'&&old.active&&old.endpoint===endpoint.value&&old.model===model.value&&!secret.value)continue;
      bindings.push({service,mode:mode.value,endpoint:endpoint.value.trim(),model:model.value.trim(),...(secret.value?{secret:secret.value}:{})});
    }
    try{
      const updated=await request('clipper/settings',{method:'POST',body:{revision:prefs.revision,values,rules:editedRules,bindings}});
      if(!current())return;
      prefs.revision=updated.revision;
      for(const [id,entry] of services){entry.secret.value='';Object.keys(entry.old).forEach(k=>delete entry.old[k]);Object.assign(entry.old,updated.bindings[id]||{});
        const remove=entry.mode.querySelector('option[value="remove"]');
        if(entry.old.bound&&!remove)option(entry.mode,'remove',tx('解除绑定','Remove binding'));
        if(!entry.old.bound)remove?.remove();
        entry.mode.value=entry.old.active?'own':'site';entry.mode.onchange();}
      window.dispatchEvent(new Event('clipper-settings-changed'));
      try {const ch=new BroadcastChannel('clipper-settings');ch.postMessage('updated');ch.close();}catch{}
      status.textContent=tx('已保存，新选区使用这些设置。','Saved. New selections use these settings.');
    }catch(e){if(current())status.textContent=e.message;}finally{save.disabled=false;}
  };
  return page;
}
