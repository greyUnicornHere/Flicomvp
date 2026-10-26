import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

describe('loadConfig', () => {
  it('uses safe development defaults', () => {
    const config = loadConfig({});
    expect(config.NODE_ENV).toBe('development');
    expect(config.MAIL_TRANSPORT).toBe('dev-outbox');
    expect(config.APP_URL).toBe('http://localhost:5173');
    expect(config.MAGIC_LINK_TTL_MINUTES).toBe(15);
    expect(config.AUTH_RATE_LIMIT).toBe(10);
  });

  it('treats empty .env values as unset', () => {
    expect(loadConfig({ SMTP_USER: '', SMTP_SECURE: '' }).SMTP_USER).toBeUndefined();
  });

  it('refuses the development outbox in production', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', APP_URL: 'https://flico.example', MAIL_TRANSPORT: 'dev-outbox' }),
    ).toThrow(/dev-outbox is not allowed in production/);
  });

  it('requires an explicit https APP_URL in production', () => {
    const smtp = { MAIL_TRANSPORT: 'smtp', SMTP_HOST: 'smtp.example', MAIL_FROM: 'Flico <no-reply@example.com>' };
    expect(() => loadConfig({ NODE_ENV: 'production', ...smtp })).toThrow(/APP_URL is required in production/);
    expect(() => loadConfig({ NODE_ENV: 'production', APP_URL: 'http://flico.example', ...smtp })).toThrow(/https/);
    expect(loadConfig({ NODE_ENV: 'production', APP_URL: 'https://flico.example', ...smtp }).NODE_ENV).toBe('production');
  });

  it('requires SMTP host and sender when MAIL_TRANSPORT=smtp', () => {
    try {
      loadConfig({ MAIL_TRANSPORT: 'smtp' });
      expect.fail('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).problems.join('\n')).toMatch(/SMTP_HOST/);
      expect((error as ConfigError).problems.join('\n')).toMatch(/MAIL_FROM/);
    }
  });

  it('never echoes secret values in errors', () => {
    try {
      loadConfig({ MAIL_TRANSPORT: 'smtp', SMTP_PASS: 'super-secret-password', PORT: 'not-a-port' });
      expect.fail('should throw');
    } catch (error) {
      expect((error as Error).message).not.toContain('super-secret-password');
    }
  });
});
