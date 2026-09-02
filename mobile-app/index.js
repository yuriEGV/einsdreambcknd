import { registerRootComponent } from 'expo';
import App from './App';

if (global.ErrorUtils) {
  global.ErrorUtils.setGlobalHandler((error, isFatal) => {
    console.warn('Global error caught:', error);
  });
}

registerRootComponent(App);