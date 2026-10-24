import { ChannelConfigError, ChannelConfigVault } from './channel-config.vault';

const SECRET = 'a-secret-key-that-is-at-least-thirty-two-characters';
const ID = '2b6a7d2e-3d7e-4a7c-9c0e-8f4b5f0f6a11';
const CONFIG = { url: 'https://hooks.example.test/services/T000/B000/XXXXXXXX', secret: 's3cr3t-s3cr3t-s3cr3t' };

describe('ChannelConfigVault', () => {
  const vault = new ChannelConfigVault(SECRET);

  it('opens what it sealed, and shows nothing of it', () => {
    const sealed = vault.seal(ID, CONFIG);

    expect(vault.isSealed(sealed)).toBe(true);
    expect(JSON.stringify(sealed)).not.toContain('hooks.example.test');
    expect(JSON.stringify(sealed)).not.toContain('XXXXXXXX');
    expect(vault.open(ID, sealed)).toEqual(CONFIG);
  });

  it('seals the same configuration differently each time', () => {
    expect(vault.seal(ID, CONFIG)).not.toEqual(vault.seal(ID, CONFIG));
  });

  it('lets a plaintext configuration of an older version through untouched', () => {
    expect(vault.isSealed(CONFIG)).toBe(false);
    expect(vault.open(ID, CONFIG)).toBe(CONFIG);
  });

  it('does not open on another channel: the id is part of what is authenticated', () => {
    const sealed = vault.seal(ID, CONFIG);

    expect(() => vault.open('00000000-0000-4000-8000-000000000000', sealed)).toThrow(ChannelConfigError);
  });

  it('refuses a configuration that was altered', () => {
    const { sealed } = vault.seal(ID, CONFIG);
    const parts = sealed.split('.');
    parts[3] = `${parts[3]?.slice(0, -2) ?? ''}AA`;

    expect(() => vault.open(ID, { sealed: parts.join('.') })).toThrow(/damaged/);
  });

  it('says that SECRET_KEY changed, rather than that something failed to authenticate', () => {
    const other = new ChannelConfigVault('another-secret-key-that-is-also-long-enough');

    expect(() => vault.open(ID, other.seal(ID, CONFIG))).toThrow(/another SECRET_KEY.*silencewatch reseal/);
  });
});
