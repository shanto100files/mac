import type {KeplerTurboModule} from '@amazon-devices/keplerscript-turbomodule-api';
import {TurboModuleRegistry} from '@amazon-devices/keplerscript-turbomodule-api';

export interface VegaTransport extends KeplerTurboModule {
  start: () => string;
  stop: () => void;
}
export default TurboModuleRegistry.getEnforcing<VegaTransport>('VegaTransport');
