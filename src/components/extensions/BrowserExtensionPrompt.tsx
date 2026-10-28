import {useEffect, useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {getPlatformHost, isTauriRuntime} from '../../platform/host';
import {useDialogFocusBoundary} from '../../lib/hooks/useDialogFocusBoundary';
import {FocusableButton} from '../layout/FocusableButton';

const storeUrl = 'https://chromewebstore.google.com/detail/vega/iofleagpffjfcaegclkgbjjfeoinmjhe';

export function browserExtensionRequired() {
  if (isTauriRuntime() || import.meta.env.VITE_TV_HOST) return false;
  try {
    const host = getPlatformHost();
    return !(host?.kind === 'browser-extension' && typeof host.request === 'function' &&
      host.capabilities.publicDestinationChecks && host.capabilities.restrictedHeaders &&
      host.capabilities.isolatedCookies && host.capabilities.manualRedirects && host.capabilities.mediaDelivery);
  } catch { return true; }
}

export function useBrowserExtensionRequired() {
  const [required, setRequired] = useState(browserExtensionRequired);
  useEffect(() => {
    let active = true;
    const update = () => {if (active) setRequired(browserExtensionRequired());};
    window.addEventListener('vega-platform-host-change', update);
    window.addEventListener('focus', update);
    const timer = setTimeout(update, 2000);
    void window.vegaPlatformHostReady?.then(update, update);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener('vega-platform-host-change', update);
      window.removeEventListener('focus', update);
    };
  }, []);
  return required;
}

export function BrowserExtensionPrompt({open, onOpenChange}: {open:boolean; onOpenChange:(open:boolean)=>void}) {
  const {ref, DialogFocusProvider} = useDialogFocusBoundary({isOpen:open,
    focusKey:'BROWSER_EXTENSION_DIALOG', preferredChildFocusKey:'BROWSER_EXTENSION_INSTALL',
    restoreFocusKey:'EXTENSIONS_ADD_SOURCE'});
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="extensions-dialog-overlay" />
      <DialogFocusProvider>
        <Dialog.Content ref={ref as any} className="extensions-dialog-content"
          onOpenAutoFocus={event=>event.preventDefault()}>
          <Dialog.Title>Install the browser extension</Dialog.Title>
          <Dialog.Description>To add providers in the web app, install the browser extension. It connects providers and enables browser playback.</Dialog.Description>
          <p style={{marginTop:16, lineHeight:1.6}}>After installing, open the extension and choose <strong>Allow all websites</strong>, then reload the app.</p>
          <div className="extensions-dialog-actions" style={{flexWrap:'wrap'}}>
            <FocusableButton focusKey="BROWSER_EXTENSION_CANCEL" className="dialog-text-button"
              onClick={()=>onOpenChange(false)}>Not now</FocusableButton>
            <FocusableButton focusKey="BROWSER_EXTENSION_RELOAD" className="dialog-text-button"
              onClick={()=>window.location.reload()}>Reload the app</FocusableButton>
            <FocusableButton focusKey="BROWSER_EXTENSION_INSTALL" className="dialog-primary-button"
              onClick={()=>window.open(storeUrl, '_blank', 'noopener,noreferrer')}>Install extension</FocusableButton>
          </div>
        </Dialog.Content>
      </DialogFocusProvider>
    </Dialog.Portal>
  </Dialog.Root>;
}
