/* Packaged bootstrap only. No provider code or remote UI is loaded here. */
(function () {
  var bridge = new PalmServiceBridge();
  bridge.onservicecallback = function (text) {
    try {
      var result = JSON.parse(text);
      if (!result.returnValue || !/^http:\/\/127\.0\.0\.1:32177\/app\/[a-f0-9]{64}\/index\.html$/.test(result.url)) throw new Error(result.errorText || 'Native host failed to start');
      location.replace(result.url);
    } catch (error) {document.getElementById('status').textContent = error.message;}
  };
  bridge.call('luna://in.vegaapp.tv.network/start', '{}');
})();
