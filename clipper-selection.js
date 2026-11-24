import {presentationMathSource} from './math-presentation.js?v=00493ad7a36c230c';
import {learningSelectionBlock} from './content-report.js?v=00493ad7a36c230c';

export const formulaSelector='[data-math-source],[data-tex],.katex-display,.katex,math,mjx-container';
const ignored='script,style,template,[hidden],[inert],button,[role="toolbar"],[data-content-actions],.sourceCodeLanguage,.clipperActions,input,textarea,select,dialog,[contenteditable="true"]';
const paragraph='p,li,td,th,pre,blockquote,h1,h2,h3,h4,h5,h6,[data-paragraph]';
const asElement=n=>n?.nodeType===1?n:n?.parentElement;
export function mathSource(node) {
  const raw=node.getAttribute('data-math-source')||node.querySelector('[data-math-source]')?.getAttribute('data-math-source');
  const annotation=node.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
  const tex=raw||node.getAttribute('data-tex')||annotation||presentationMathSource(node)||
    node.getAttribute('aria-label')||node.querySelector('svg[aria-label]')?.getAttribute('aria-label')||node.textContent;
  if(!tex)return '';
  const display=node.matches('.mathDisplay,.katex-display,[display="block"],[display="true"]');
  if(/^(?:\\\(|\\\[|\$)/.test(tex.trim()))return tex.trim();
  return display?'\\['+tex.trim()+'\\]':'\\('+tex.trim()+'\\)';
}

export function formulaAt(node) {
  let formula = asElement(node)?.closest(formulaSelector);
  for (let parent; (parent = formula?.parentElement?.closest(formulaSelector));) formula = parent;
  return formula;
}

function formulaFragment(formula, range) {
  if (!formula.contains(range.startContainer) && !formula.contains(range.endContainer)) return null;
  const visible = formula.querySelector('.katex-html') || formula;
  const walker = document.createTreeWalker(visible, NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.data && !node.parentElement.closest('.katex-mathml,annotation,annotation-xml,svg,[hidden]')
      ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const first = nodes[0], last = nodes.at(-1);
  if (!first || range.comparePoint(first, 0) === 0 && range.comparePoint(last, last.length) === 0) return null;
  return nodes;
}

// Assign each emitted character to its original DOM range. Occurrences with identical text retain distinct offsets.
export function captureSelection(range,root){
  const a=asElement(range.startContainer), b=asElement(range.endContainer), common=asElement(range.commonAncestorContainer);
  if(!a||!b||!common||!root.contains(common))return null;
  let container=a.closest(paragraph);
  if(!container?.contains(b)) {
    const block=learningSelectionBlock(a);
    container=block?.contains(b)?block:formulaAt(common)||common;
  }
  const pieces=[], assets=[];
  const emit=(s,zone,kind='literal',inlineMath=false)=>{if(s)pieces.push({s,zone,kind,inlineMath});};
  function location(node){
    if(range.intersectsNode(node))return 0;
    const point=document.createRange();point.selectNode(node);
    return point.compareBoundaryPoints(Range.END_TO_START,range)<=0?-1:1;
  }
  function visit(n,verbatim=false) {
    if(n.nodeType===Node.TEXT_NODE){
      const text=n.data;
      const start=n===range.startContainer?range.startOffset:0, end=n===range.endContainer?range.endOffset:text.length;
      const part=(s,zone)=>{if(verbatim)emit(s,zone);else for(const run of s.matchAll(/\s+|\S+/gu))
        emit(run[0],zone,/^\s/u.test(run[0])?'space':'literal');};
      if(!range.intersectsNode(n)){part(text,range.comparePoint(n,0)<0?-1:1);return;}
      part(text.slice(0,start),-1);part(text.slice(start,end),0);part(text.slice(end),1);return;
    }
    if(n.nodeType!==Node.ELEMENT_NODE||n.matches(ignored))return;
    const style=getComputedStyle(n);
    if(style.display==='none'||style.visibility==='hidden')return;
    const zone=location(n);
    if(n.matches(formulaSelector)){
      const fragment = zone === 0 && formulaFragment(n, range);
      if (fragment) {
        for (const text of fragment) visit(text, true);
        return;
      }
      const formula=mathSource(n);
      emit(formula,zone,'literal',!formula.startsWith('\\[')&&!formula.startsWith('$$'));return;
    }
    if(n.getAttribute('aria-hidden')==='true')return;
    if(n.tagName==='IMG'){
      // Only the selected image is material; images outside the selection keep their visible label in context.
      const alt=(n.getAttribute('alt')||'图片').replace(/[\[\]\\\n]/g,' ');
      if(zone===0){emit('!['+alt+'](clipper-image:'+assets.length+')',zone);assets.push(n);}
      else emit(alt,zone);
      return;
    }
    if(n.tagName==='BR'){emit('\n',zone,'line');return;}
    if(n.matches('details:not([open])')){const summary=n.querySelector(':scope > summary');if(summary)visit(summary);return;}
    const code=n.tagName==='PRE', inline=n.tagName==='CODE'&&!verbatim;
    const language=code?(n.querySelector('code')?.className||'').match(/(?:^|\s)language-([\w+-]+)/)?.[1]||'':'';
    const fence=code||inline?'`'.repeat(Math.max(code?3:1,...[...n.textContent.matchAll(/`+/g)].map(m=>m[0].length+1))):'';
    const breakKind=n.tagName==='LI'||n.tagName==='TR'?'line':n.matches('p,pre,blockquote,h1,h2,h3,h4,h5,h6,ul,ol,table,[data-paragraph]')?'paragraph':null;
    const edge=(before)=>{
      const index=[...n.parentNode.childNodes].indexOf(n)+(before?0:1);
      return range.comparePoint(n.parentNode,index);
    };
    if(breakKind)emit('\n',edge(true),breakKind);
    if(n.tagName==='LI'&&n!==container){
      const siblings=[...n.parentElement.children].filter(x=>x.tagName==='LI');
      const marker=n.parentElement.tagName==='OL'?((Number(n.parentElement.getAttribute('start'))||1)+siblings.indexOf(n))+'. ':'- ';
      emit(marker,edge(true));
    }
    // Fences also enclose a partial selection inside a code block.
    if(fence)emit(fence+(code?language+'\n':''),zone);
    for(const child of n.childNodes)visit(child,verbatim||code||inline);
    if(fence)emit((code?'\n':'')+fence,zone);
    if(n.matches('td,th')&&n.nextElementSibling)emit('\t',edge(false),'tab');
    if(breakKind)emit('\n',edge(false),breakKind);
  }
  visit(container);
  // A normal-flow line wrap has no semantic newline. Preserve genuine breaks, table cells and exact code whitespace.
  const chunks=[];let pending=[];
  const cjk=c=>!!c&&/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}，。；：！？、（）《》]/u.test(c);
  for(const run of pieces){
    if(run.kind!=='literal'){pending.push(run);continue;}
    if(pending.length&&chunks.length){
      const p=pending.find(t=>t.kind==='paragraph')||pending.find(t=>t.kind==='line')||pending.find(t=>t.kind==='tab')||pending[0];
      const previous=chunks.at(-1),before=previous.s.at(-1),after=run.s[0];
      let separator=p.kind==='paragraph'?'\n\n':p.kind==='line'?'\n':p.kind==='tab'?'\t':' ';
      if(p.kind==='line'&&pending.filter(part=>part.kind==='line').length===1&&(previous.inlineMath||run.inlineMath))separator=' ';
      if(p.kind==='space'&&pending.some(t=>/[\r\n]/.test(t.s))&&cjk(before)&&cjk(after))separator='';
      chunks.push({s:separator,zone:p.zone});
    }
    pending=[];chunks.push(run);
  }
  const first=chunks.findIndex(v=>v.zone===0);
  if(first<0)return null;
  const join=parts=>parts.map(p=>p.s).join('');
  // Code fences wrap the selected code itself, without including unselected code as the target.
  const before=join(chunks.filter(x=>x.zone<0)), after=join(chunks.filter(x=>x.zone>0));
  const middle=join(chunks.filter(p=>p.zone===0));
  const text=middle.trim();
  if(!text)return null;
  const leading=middle.length-middle.trimStart().length,trailing=middle.length-middle.trimEnd().length;
  const prefix=before+middle.slice(0,leading), suffix=(trailing?middle.slice(-trailing):'')+after;
  return {text,prefix:prefix.slice(-4000),suffix:suffix.slice(0,4000),assets,
    isImage:assets.length===1&&/^!\[[^\]]*\]\(clipper-image:0\)$/.test(text)};
}
