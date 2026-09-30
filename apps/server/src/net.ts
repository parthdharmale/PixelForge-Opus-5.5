/**
 * Outbound HTTP. Honour HTTPS_PROXY / NO_PROXY when they are set (corporate
 * networks, sandboxes); otherwise use Node's default fetch.
 */
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

export function configureNetwork() {
  if (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY) {
    setGlobalDispatcher(new EnvHttpProxyAgent());
  }
}
