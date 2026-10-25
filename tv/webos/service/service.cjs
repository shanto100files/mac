const Service = require('webos-service');
const {startHost} = require('./host.cjs');
const service = new Service('in.vegaapp.tv.network');
let host, starting, activity;
service.register('start', message => {
  // Other installed apps cannot ask this service to perform requests or reveal its session.
  if (message.sender !== 'in.vegaapp.tv') return message.respond({returnValue:false, errorText:'Caller is not authorized'});
  if (!starting) starting = startHost({root:require('path').join(__dirname, 'ui'), port:32177}).then(value => {
    host = value;
    service.activityManager.create('Vega foreground app', value => {activity = value;});
    return value;
  }).catch(error => {starting = undefined; throw error;});
  starting.then(value => message.respond({returnValue:true, url:value.url}), error => message.respond({returnValue:false, errorText:error.message}));
});
setInterval(() => {
  if (host && Date.now() - host.lastSeen > 90_000) {
    host.close(); host = undefined; starting = undefined;
    if (activity) service.activityManager.complete(activity, {}, () => {});
    activity = undefined;
  }
}, 30_000).unref();
