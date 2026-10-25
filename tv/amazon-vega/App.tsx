import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {WebView} from '@amazon-devices/webview';
import VegaTransport from './turbo-modules/NativeVegaTransport';

export const App = () => {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    try {
      const value = VegaTransport.start();
      if (!/^http:\/\/127\.0\.0\.1:32178\/app\/[a-f0-9]{64}\/index\.html$/.test(value)) throw new Error('Vega native networking failed to start');
      setUrl(value);
    } catch (error) {setError(String(error));}
    return () => VegaTransport.stop();
  }, []);
  return <View style={styles.container}>{error ? <Text style={styles.text}>{error}</Text> : url ? <WebView style={styles.container}
    source={{uri:url}} javaScriptEnabled={true} hasTVPreferredFocus={true}
    allowSystemKeyEvents={true} allowsDefaultMediaControl={true}
    onShouldStartLoadWithRequest={request => request.url.startsWith(url.slice(0, url.lastIndexOf('/') + 1))}
    onError={event => setError(event.nativeEvent.description)} /> : <Text style={styles.text}>{error || 'Starting Vega…'}</Text>}</View>;
};
const styles = StyleSheet.create({container:{flex:1, backgroundColor:'#000'}, text:{color:'#fff', fontSize:24, padding:40}});
export default App;
