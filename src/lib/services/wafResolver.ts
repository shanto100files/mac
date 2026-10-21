import {openWebView as openProviderWebView} from '../../platform/waf';
import {LOCAL_AUTHOR} from '../providers/providerScope';
import type {OpenWebViewOptions} from '../providers/types';

export const openWebView = (url: string, options?: OpenWebViewOptions) =>
  openProviderWebView(url, options, LOCAL_AUTHOR);
