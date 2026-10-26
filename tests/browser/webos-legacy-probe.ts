import {providerManager} from '../../src/lib/services/ProviderManager';
import {getLibmediaRuntimeError} from '../../src/lib/player/libmediaRuntime';
import type {LibmediaPlayerAdapter} from '../../src/lib/player/LibmediaPlayerAdapter';

// Synthetic emulator-test entry only. Never a bundled/installed provider.
let engine:LibmediaPlayerAdapter|undefined;
let surface:HTMLDivElement|undefined;
(window as any).webosLegacyProbe={
  runtimeError:()=>getLibmediaRuntimeError(),
  async provider(){return providerManager.executeModule({code:'exports.probe=()=>({answer:42,windowType:typeof window});',author:'legacy-emulator-fixture'},'legacy-emulator-fixture','probe',{});},
  async providerCancellation(){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),100);
    try{await providerManager.executeModule({code:'exports.probe=()=>{while(true){}};',author:'legacy-emulator-fixture'},'legacy-emulator-fixture','probe',{},controller.signal);return false;}
    catch{return true;}finally{clearTimeout(timer);}
  },
  async load(name='fixture.mkv',format='mkv'){
    const unsupported=getLibmediaRuntimeError();
    if(unsupported)throw new Error(unsupported);
    await engine?.destroy();surface?.remove();
    const {LibmediaPlayerAdapter}=await import('../../src/lib/player/LibmediaPlayerAdapter');
    surface=document.createElement('div');surface.style.cssText='position:fixed;top:100px;left:120px;width:640px;height:360px;background:black;z-index:1000';document.body.appendChild(surface);
    const video=document.createElement('video');surface.appendChild(video);
    engine=new LibmediaPlayerAdapter(video);
    await engine.load(new URL(name,location.href).href,{streamType:format});
    return engine.state;
  },
  async seek(time:number){await engine?.seek(time);return engine?.state;},
  async audio(id:number){await engine?.selectTrack('aid',id);return engine?.state;},
  async subtitle(id:number){await engine?.selectTrack('sid',id);return engine?.state;},
  async pause(){engine?.pause();return engine?.state;},
  async play(){await engine?.play();return engine?.state;},
  state(){return engine?.state;},
  async dispose(){await engine?.destroy();engine=undefined;surface?.remove();surface=undefined;return true;},
};
