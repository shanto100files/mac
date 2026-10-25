import {create} from 'zustand';
import {settingsStorage} from '../storage/SettingsStorage';

interface ConsentRequest {
  id: number;
  provider: string;
  url: string;
  finish: (allow: boolean, remember?: boolean) => void;
}
interface ConsentState {requests: ConsentRequest[]}
export const useVerificationConsentStore = create<ConsentState>(() => ({requests: []}));
let sequence = 0;

/** The same user-controlled gate precedes browser and native window creation. */
export async function authorizeVerification(provider: string, url: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const policy = settingsStorage.getVerificationWindowPolicy();
  if (policy === 'block') throw new Error('Provider verification windows are blocked in Settings.');
  if (policy === 'allow') return;
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    let settled = false;
    const abort = () => finish(false, false, signal?.reason || new DOMException('Aborted', 'AbortError'));
    const finish = (allow: boolean, remember = false, error?: Error) => {
      if (settled) return;
      try {if (remember) settingsStorage.setVerificationWindowPolicy(allow ? 'allow' : 'block');}
      catch (failure) {error = failure instanceof Error ? failure : new Error('Could not save verification permission.'); allow = false;}
      settled = true; signal?.removeEventListener('abort', abort);
      useVerificationConsentStore.setState(state => ({requests: state.requests.filter(request => request.id !== id)}));
      if (!allow || settingsStorage.getVerificationWindowPolicy() === 'block') reject(error || new Error('Provider verification was stopped.'));
      else resolve();
      if (remember && !error) for (const pending of [...useVerificationConsentStore.getState().requests]) pending.finish(allow);
    };
    useVerificationConsentStore.setState(state => ({requests: [...state.requests, {id, provider, url, finish}]}));
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) abort();
  });
}
