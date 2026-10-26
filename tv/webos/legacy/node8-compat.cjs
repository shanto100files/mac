// Conditional startup shims for Node 12 webOS packages and older diagnostics.
const util = require('util');
const fs = require('fs');
const dns = require('dns');
if (typeof global.URL === 'undefined') global.URL = require('url').URL;
if (!fs.promises) fs.promises = {stat: util.promisify(fs.stat)};
if (!dns.promises) dns.promises = {lookup: util.promisify(dns.lookup)};
if (!Object.fromEntries) Object.fromEntries = entries => entries.reduce((value, entry) => {
  Object.defineProperty(value, entry[0], {value:entry[1], configurable:true, enumerable:true, writable:true});
  return value;
}, {});
if (!String.prototype.trimStart) Object.defineProperty(String.prototype, 'trimStart', {value:String.prototype.trimLeft, configurable:true, writable:true});
if (typeof global.AbortController === 'undefined') {
  class Signal {
    constructor() {this.aborted=false;this.reason=undefined;this.listeners=new Map();}
    addEventListener(type, listener, options) {if(type==='abort')this.listeners.set(listener,!!(options&&options.once));}
    removeEventListener(type, listener) {if(type==='abort')this.listeners.delete(listener);}
    throwIfAborted() {if(this.aborted)throw this.reason;}
  }
  global.AbortController = class AbortController {
    constructor() {this.signal=new Signal();}
    abort(reason) {
      if(this.signal.aborted)return;
      this.signal.aborted=true;this.signal.reason=reason||new Error('Request aborted');
      for(const [listener,once] of this.signal.listeners) {
        if(once)this.signal.listeners.delete(listener);
        listener.call(this.signal,{type:'abort',target:this.signal});
      }
    }
  };
}
