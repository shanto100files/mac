import {HtmlVideoEngine} from '../../src/lib/player/HtmlVideoEngine';
import {providerManager} from '../../src/lib/services/ProviderManager';
import {LegacyTextSubtitles} from '../../src/platform/legacy/LegacyTextSubtitles';

// Synthetic fixtures only. This entry is built/copied by emulator tests, never
// installed as a provider or shipped in the production application bundle.
let engine:HtmlVideoEngine|undefined;
let surface:HTMLDivElement|undefined;
let state:unknown;
let errors:string[]=[];
(window as any).webosLegacyProbe={
  async provider(){return providerManager.executeModule({code:'exports.probe=()=>({answer:42,windowType:typeof window});',author:'legacy-emulator-fixture'},'legacy-emulator-fixture','probe',{});},
  async providerCancellation(){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),100);
    try{await providerManager.executeModule({code:'exports.probe=()=>{while(true){}};',author:'legacy-emulator-fixture'},'legacy-emulator-fixture','probe',{},controller.signal);return false;}
    catch{return true;}finally{clearTimeout(timer);}
  },
  async load(name='fixture.mp4'){
    if(engine)await engine.destroy();surface?.remove();errors=[];
    surface=document.createElement('div');surface.style.cssText='position:fixed;top:100px;left:120px;width:640px;height:360px;background:black;z-index:1000';document.body.appendChild(surface);
    const video=document.createElement('video');video.style.cssText='width:100%;height:100%';surface.appendChild(video);
    engine=new HtmlVideoEngine(video);
    engine.subscribe(value=>{state={status:value.isBuffering?'buffering':value.isPaused?'paused':'playing',time:value.currentTime,duration:value.duration,audioTracks:value.audioTracks,subtitleTracks:value.subtitleTracks,error:value.error};if(value.error)errors.push(value.error);});
    await engine.load(new URL(name,location.href).href);
    return state;
  },
  async seek(time:number){await engine?.seek(time);return state;},
  async audio(id:number){await engine?.selectTrack('aid',id);return state;},
  async subtitles(){
    const video=surface!.querySelector('video')!;
    const deadline=Date.now()+10000;
    while(video.readyState<2){if(Date.now()>deadline)throw new Error('Video did not become ready for subtitle test');await new Promise(resolve=>setTimeout(resolve,100));}
    const subtitles=new LegacyTextSubtitles(video);
    subtitles.setContent('1\n00:00:01,000 --> 00:00:15,000\n{\\an8}Vega subtitle clock check');
    video.currentTime=5;
    await new Promise<void>(resolve=>{if(!video.seeking)resolve();else video.addEventListener('seeked',()=>resolve(),{once:true});});
    const track=video.textTracks[video.textTracks.length-1];
    const active=Array.from(track.activeCues||[]).map(cue=>(cue as VTTCue).text);
    subtitles.setDelay(2000);
    const shifted=Array.from(track.cues||[]).map(cue=>({start:cue.startTime,end:cue.endTime}));
    subtitles.destroy();
    track.mode='hidden';const cleared=track.cues?.length===0;track.mode='disabled';
    return {time:video.currentTime,active,shifted,cleared};
  },
  async pause(){await engine?.pause();return state;},
  async resumeAudio(){await engine?.play();return state;},
  state(){return {state,errors};},
  async dispose(){await engine?.destroy();engine=undefined;surface?.remove();surface=undefined;return true;},
};
