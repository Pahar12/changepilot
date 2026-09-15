'use strict';

/**
 * src/ai/index.js — the provider abstraction.
 *
 * This is the ONLY file the rest of ChangePilot (services, controllers)
 * should import from src/ai/providers/*. Nothing outside this module
 * should know which vendor is in use — every provider implements the same
 * conceptual interface:
 *
 *   { identifier: string, analyze(input: Object) => Promise<Object> }
 *
 * `analyze` returns a *raw, unvalidated* JSON-shaped object. It is the
 * caller's responsibility (see ../services/aiAnalysisService.js) to run
 * that object through ../ai/schema.js before trusting or persisting it.
 *
 * Provider selection is driven by the AI_PROVIDER environment variable
 * (see src/config/env.js), and defaults to "fake" — deliberately.
 * ChangePilot must be runnable and testable with zero AI configuration:
 * a fresh clone, `npm install`, `npm test`, all without an API key or
 * network access. Real analysis requires explicitly opting in with
 * AI_PROVIDER=openai (and OPENAI_API_KEY) in the environment.
 */

const env = require('../config/env');
const fakeProvider = require('./providers/fakeProvider');
const openaiProvider = require('./providers/openaiProvider');

const PROVIDERS = {
  fake: fakeProvider,
  openai: openaiProvider
};

/**
 * Resolve the configured AI provider.
 *
 * @param {string} [name] - defaults to env.aiProvider (AI_PROVIDER env var, "fake" if unset)
 * @returns {{ identifier: string, analyze: Function }}
 * @throws {Error} when the named provider is not registered
 */
function getProvider(name = env.aiProvider) {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown AI provider "${name}". Available providers: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return provider;
}

module.exports = { getProvider };
