import {cacheStorageService} from '../storage';
import {SITE_ORIGIN} from '../siteConfig';

// 1 hour
const expireTime = 60 * 60 * 1000;

export const getBaseUrl = async (providerValue: string) => {
  try {
    let baseUrl = '';
    const cacheKey = 'CacheBaseUrl' + providerValue;
    const timeKey = 'baseUrlTime' + providerValue;

    const cachedUrl = cacheStorageService.getString(cacheKey);
    const cachedTime = cacheStorageService.getObject<number>(timeKey);

    if (cachedUrl && cachedTime && Date.now() - cachedTime < expireTime) {
      baseUrl = cachedUrl;
    } else {
      /* Domain mirrors already ship in the site manifest as `mainUrl`, so the
         resolver reads them from our own backend instead of a third-party list
         that only knew about one provider. */
      const baseUrlRes = await fetch(`${SITE_ORIGIN}/api/app/manifest.json`);
      const baseUrlData = (await baseUrlRes.json()) as {
        providers?: { value: string; mainUrl?: string }[];
      };
      baseUrl = baseUrlData?.providers?.find(p => p.value === providerValue)?.mainUrl || '';
      if (baseUrl) {
        cacheStorageService.setString(cacheKey, baseUrl);
        cacheStorageService.setObject(timeKey, Date.now());
      }
    }
    return baseUrl;
  } catch (error) {
    console.error(`Error fetching baseUrl: ${providerValue}`, error);
    return '';
  }
};
