/** Text cues use the TV's media clock; no polling or separate subtitle clock. */
export class LegacyTextSubtitles {
  private track:TextTrack;
  private cues:{start:number;end:number;text:string}[]=[];
  private delay=0;
  constructor(video:HTMLVideoElement){this.track=video.addTextTrack('subtitles','External subtitles');this.track.mode='disabled';}
  setContent(content:string|null):void{
    this.cues=[];
    if(content&&/\[Script Info\]|^Dialogue:/m.test(content)){
      this.render();
      throw new Error('ASS subtitles are unavailable on older webOS. Choose SRT or WebVTT.');
    }
    const seconds=(value:string)=>{
      const parts=value.replace(',','.').split(':').map(Number);
      return parts.reduce((total,part)=>total*60+part,0);
    };
    for(const block of (content||'').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split(/\n{2,}/)){
      const lines=block.split('\n');const index=lines.findIndex(line=>line.includes('-->'));
      if(index<0)continue;
      const match=lines[index].match(/((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d+:)?\d{2}:\d{2}[.,]\d{3})/);
      if(!match)continue;
      const start=seconds(match[1]),end=seconds(match[2]);
      if(Number.isFinite(start)&&end>start)this.cues.push({start,end,text:lines.slice(index+1).join('\n').replace(/\{\\[^}]*\}/g,'')});
    }
    this.render();
  }
  setDelay(milliseconds:number):void{this.delay=milliseconds/1000;this.render();}
  private render():void{
    // Chromium 68 hides `cues` while disabled. Read/remove them in hidden mode
    // before replacing a track or changing delay, otherwise old cues accumulate.
    this.track.mode='hidden';
    for(const cue of Array.from(this.track.cues||[]))this.track.removeCue(cue);
    for(const cue of this.cues){if(cue.end+this.delay>0)this.track.addCue(new VTTCue(Math.max(0,cue.start+this.delay),cue.end+this.delay,cue.text));}
    this.track.mode=this.cues.length?'showing':'disabled';
  }
  destroy():void{this.cues=[];this.render();}
}
