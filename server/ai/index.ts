import { aiProviderKind, type Config } from '../config.js';
import { AnthropicProvider } from './anthropic.js';
import { FixtureProvider } from './fixture.js';
import type { AiProvider } from './provider.js';

/** The configured provider, or null when AI isn't set up (features then say so instead of pretending). */
export function createProvider(config: Config): AiProvider | null {
  switch (aiProviderKind(config)) {
    case 'anthropic':
      return new AnthropicProvider(config.ANTHROPIC_API_KEY!, config.AI_MODEL);
    case 'fixture':
      return config.NODE_ENV === 'production' ? null : new FixtureProvider();
    case 'none':
      return null;
  }
}
