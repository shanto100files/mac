import {copyLibmediaAssets} from '@vega/libmedia-engine/assets';
import {fileURLToPath} from 'node:url';
copyLibmediaAssets(fileURLToPath(new URL('../public/',import.meta.url)));
