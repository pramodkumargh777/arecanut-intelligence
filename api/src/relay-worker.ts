/**
 * Entry point of the relay Worker (wrangler.relay.toml). The Workers runtime treats every named export of the entry
 * module as an entrypoint and refuses plain values, so the logic and its constants live in agmarknet-relay.ts and this
 * module exports only the handler.
 */
import { handleRelay, type RelayEnv } from "./agmarknet-relay";

export default { fetch: (request: Request, env: RelayEnv) => handleRelay(request, env) };
