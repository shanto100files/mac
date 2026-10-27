import {useEffect, useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {LuExternalLink} from 'react-icons/lu';
import {useVerificationConsentStore} from '../lib/zustand/verificationConsentStore';
import {useDialogFocusBoundary} from '../lib/hooks/useDialogFocusBoundary';
import {FocusableButton} from './layout/FocusableButton';
import './VerificationConsentDialog.css';
import {getPlatformHost} from '../platform/host';

export function VerificationConsentDialog() {
  const request = useVerificationConsentStore(state => state.requests[0]);
  const failure = useVerificationConsentStore(state => state.failure);
  const dismissFailure = () => useVerificationConsentStore.setState({failure: null});
  const [remember, setRemember] = useState(false);
  useEffect(() => setRemember(false), [request?.id]);
  const {ref, DialogFocusProvider} = useDialogFocusBoundary({isOpen: Boolean(request || failure), focusKey: 'VERIFICATION_CONSENT', preferredChildFocusKey: 'VERIFICATION_STOP'});
  if (!request && failure) return <Dialog.Root open onOpenChange={open => {if (!open) dismissFailure();}}>
    <Dialog.Portal>
      <Dialog.Overlay className="extensions-dialog-overlay" />
      <DialogFocusProvider>
        <Dialog.Content ref={ref as any} className="extensions-dialog-content verification-consent">
          <Dialog.Title>Provider verification failed</Dialog.Title>
          <Dialog.Description>{failure}</Dialog.Description>
          {/Allow in Incognito/i.test(failure) && <p className="verification-consent-warning">Open the Vega extension, choose Verification settings, and enable Allow in Incognito. Then reload Vega and try again. The browser requires you to change this setting manually.</p>}
          <div className="extensions-dialog-actions"><FocusableButton className="dialog-primary-button" focusKey="VERIFICATION_STOP" onClick={dismissFailure}>Close</FocusableButton></div>
        </Dialog.Content>
      </DialogFocusProvider>
    </Dialog.Portal>
  </Dialog.Root>;
  if (!request) return null;
  return <Dialog.Root open onOpenChange={open => {if (!open) request.finish(false);}}>
    <Dialog.Portal>
      <Dialog.Overlay className="extensions-dialog-overlay" />
      <DialogFocusProvider>
        <Dialog.Content ref={ref as any} className="extensions-dialog-content verification-consent" onOpenAutoFocus={event => {event.preventDefault();}}>
          <span className="verification-consent-icon"><LuExternalLink size={24}/></span>
          <Dialog.Title>Open provider verification window?</Dialog.Title>
          <Dialog.Description><strong>{request.provider}</strong> wants to open a new window to verify access to its website.</Dialog.Description>
          <p className="verification-consent-site">{new URL(request.url).origin}</p>
          <p className="verification-consent-warning">Only enter personal information in this window if you trust the provider.</p>
          {getPlatformHost()?.kind === 'browser-extension' && <p className="verification-consent-help">Requires Allow in Incognito in the Vega extension settings. Your browser does not prompt for this permission automatically.</p>}
          <FocusableButton className="verification-consent-remember" role="checkbox" aria-checked={remember} onClick={() => setRemember(value => !value)} focusKey="VERIFICATION_REMEMBER">
            <span aria-hidden="true" className={`verification-consent-check${remember ? ' checked' : ''}`}>{remember ? '✓' : ''}</span> Don’t ask again
          </FocusableButton>
          <p className="verification-consent-help">Remember this choice for all providers. Change it in Settings → Preferences → Provider verification windows.</p>
          <div className="extensions-dialog-actions">
            <FocusableButton className="dialog-text-button" focusKey="VERIFICATION_STOP" onClick={() => request.finish(false, remember)}>Stop</FocusableButton>
            <FocusableButton className="dialog-primary-button" focusKey="VERIFICATION_CONFIRM" onClick={() => request.finish(true, remember)}>Confirm</FocusableButton>
          </div>
        </Dialog.Content>
      </DialogFocusProvider>
    </Dialog.Portal>
  </Dialog.Root>;
}
