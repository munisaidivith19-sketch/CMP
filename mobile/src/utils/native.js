import { requireOptionalNativeModule } from 'expo';
import Constants, { ExecutionEnvironment } from 'expo-constants';

/**
 * Native code only exists in the app binary that was built. JavaScript can be
 * newer than the installed build (a dev client built before a native package
 * was added), and Expo Go deliberately blocks some modules. Importing such a
 * package normally throws at module load and takes whole screens down with it,
 * so features check here first and degrade instead.
 */
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export const hasNativeModule = (name) => Boolean(requireOptionalNativeModule(name));

/** Message for a feature whose native module this build does not contain. */
export const UPDATE_APP_MESSAGE = 'This feature needs the latest version of the Vexon app. Please update or reinstall the app and try again.';
