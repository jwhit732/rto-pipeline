import { describe, it, expect, beforeEach } from 'vitest';

describe('config module', () => {
  beforeEach(() => {
    // Reset env before each test
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['BATCH_SIZE'];
    delete process.env['BATCH_DELAY_MS'];
  });

  it('throws when a required env var is missing', async () => {
    const { config } = await import('../src/shared/config.js');
    // Delete after import so dotenv doesn't restore it; config checks process.env at call time
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(() => config.anthropicApiKey()).toThrow('ANTHROPIC_API_KEY');
    } finally {
      process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it('returns default batch size when BATCH_SIZE is not set', async () => {
    const { config } = await import('../src/shared/config.js');
    expect(config.batchSize()).toBe(50);
  });

  it('returns default batch delay when BATCH_DELAY_MS is not set', async () => {
    const { config } = await import('../src/shared/config.js');
    expect(config.batchDelayMs()).toBe(2000);
  });

  it('reads BATCH_SIZE from environment', async () => {
    process.env['BATCH_SIZE'] = '100';
    const { config } = await import('../src/shared/config.js');
    expect(config.batchSize()).toBe(100);
  });
});
