// Separate classic-script bundle; never imported by modern app entry points.
import 'core-js/actual';

if (typeof crypto.randomUUID !== 'function') {
  Object.defineProperty(crypto, 'randomUUID', {configurable:true, value: () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const hex=Array.from(bytes, value=>value.toString(16).padStart(2,'0'));
    return `${hex.slice(0,4).join('')}-${hex.slice(4,6).join('')}-${hex.slice(6,8).join('')}-${hex.slice(8,10).join('')}-${hex.slice(10).join('')}`;
  }});
}

if (typeof AbortController !== 'undefined' && !('reason' in AbortSignal.prototype)) {
  const reasons=new WeakMap<AbortSignal,unknown>();
  const original=AbortController.prototype.abort;
  AbortController.prototype.abort=function(reason?:unknown) {
    if(!this.signal.aborted)reasons.set(this.signal, reason===undefined?new DOMException('Aborted','AbortError'):reason);
    return original.call(this);
  };
  Object.defineProperty(AbortSignal.prototype,'reason',{configurable:true,get(){return reasons.get(this);}});
}
if (typeof AbortSignal !== 'undefined' && !AbortSignal.prototype.throwIfAborted) {
  AbortSignal.prototype.throwIfAborted=function(){if(this.aborted)throw this.reason||new DOMException('Aborted','AbortError');};
}

// CSS aspect-ratio is unavailable on Chromium 68. Resize only elements whose
// legacy stylesheet declares a ratio; their child images retain object-fit.
if (typeof document !== 'undefined') {
  const start=()=>{
    const seen=new WeakSet<Element>();
    const observer=new ResizeObserver(entries=>{
      for(const {target} of entries){
        const element=target as HTMLElement;
        const parts=getComputedStyle(element).getPropertyValue('--legacy-aspect-ratio').split('/').map(Number);
        const ratio=parts[0]/(parts[1]||1);
        if(ratio>0&&element.clientWidth>0)element.style.height=`${element.clientWidth/ratio}px`;
      }
    });
    const scan=(parent:Element)=>{
      for(const element of [parent,...Array.from(parent.querySelectorAll('*'))]){
        if(!seen.has(element)&&getComputedStyle(element).getPropertyValue('--legacy-aspect-ratio').trim()){
          seen.add(element);observer.observe(element);
        }
      }
    };
    new MutationObserver(records=>{
      for(const record of records){for(const node of record.removedNodes){if(node instanceof Element){observer.unobserve(node);for(const child of Array.from(node.querySelectorAll('*')))observer.unobserve(child);}}
        for(const node of record.addedNodes)if(node instanceof Element)scan(node);
      }
    }).observe(document.body,{childList:true,subtree:true});
    scan(document.body);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
}
