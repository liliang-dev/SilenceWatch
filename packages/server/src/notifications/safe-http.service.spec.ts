import { loadConfig } from '../config/config';
import { SafeHttpService } from './safe-http.service';

function service(allowPrivate: boolean): SafeHttpService {
  const config = loadConfig({
    DATABASE_URL: 'postgresql://localhost:5432/silencewatch',
    SECRET_KEY: 'x'.repeat(32),
    ALLOW_PRIVATE_NOTIFICATION_TARGETS: allowPrivate ? 'true' : 'false',
  } as NodeJS.ProcessEnv);
  return new SafeHttpService(config);
}

describe('SafeHttpService address vetting', () => {
  const guarded = service(false);

  it('blocks loopback, link-local and private ranges', () => {
    for (const address of [
      '127.0.0.1',
      '127.1.2.3',
      '0.0.0.0',
      '10.0.0.1',
      '172.16.5.4',
      '172.31.255.255',
      '192.168.1.1',
      '100.64.0.1',
      // The one that matters most: cloud instance metadata.
      '169.254.169.254',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      '::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'ff02::1',
      // IPv4-mapped IPv6 must be judged as IPv4, not waved through.
      '::ffff:169.254.169.254',
      '::ffff:127.0.0.1',
    ]) {
      expect(guarded.isAllowedAddress(address)).toBe(false);
    }
  });

  it('allows public addresses', () => {
    for (const address of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700::1111']) {
      expect(guarded.isAllowedAddress(address)).toBe(true);
    }
  });

  it('rejects anything that is not an IP address', () => {
    for (const value of ['', 'localhost', 'not-an-ip', '999.999.999.999']) {
      expect(guarded.isAllowedAddress(value)).toBe(false);
    }
  });

  it('lets self-hosters opt in to private targets explicitly', () => {
    expect(service(true).isAllowedAddress('10.0.0.5')).toBe(true);
  });

  it('refuses unsupported protocols and embedded credentials', async () => {
    await expect(guarded.send({ url: 'file:///etc/passwd' })).rejects.toThrow(/unsupported protocol/);
    await expect(guarded.send({ url: 'gopher://example.com/' })).rejects.toThrow(
      /unsupported protocol/,
    );
    await expect(guarded.send({ url: 'https://user:pass@example.com/hook' })).rejects.toThrow(
      /embedded credentials/,
    );
  });

  it('reports a clear reason when a target resolves to a blocked range', async () => {
    await expect(guarded.assertTargetIsAllowed('https://localhost/hook')).rejects.toThrow(
      /private or reserved address/,
    );
    await expect(guarded.assertTargetIsAllowed('ftp://example.com')).rejects.toThrow(
      /only http\(s\)/,
    );
    await expect(guarded.assertTargetIsAllowed('nonsense')).rejects.toThrow(/not a valid URL/);
    await expect(
      guarded.assertTargetIsAllowed('https://user:pass@example.com/hook'),
    ).rejects.toThrow(/embedded credentials/);
  });

  /**
   * The regression that motivated `assertLiteralHostIsAllowed`: Node's http
   * client resolves nothing when the host is already an address, so the
   * `lookup` guard — the whole SSRF defence — is simply never called for a URL
   * that names its target numerically. These must be refused before a socket
   * is opened, on both entry points.
   */
  it('refuses an IP literal without ever consulting the resolver', async () => {
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://127.0.0.1:8080/hook',
      'https://10.0.0.5/hook',
      'http://[::1]:8080/hook',
      'http://[fd00::1]/hook',
      // IPv4-mapped, the usual way around a naive IPv4-only check.
      'http://[::ffff:169.254.169.254]/latest/meta-data/',
    ]) {
      await expect(guarded.send({ url })).rejects.toThrow(/private or reserved address/);
      await expect(guarded.assertTargetIsAllowed(url)).rejects.toThrow(
        /private or reserved address/,
      );
    }
  });

  it('still allows a public address given numerically', async () => {
    // Reaching the network is the pass condition, so failing to connect is
    // fine — being refused by our own check is not.
    await expect(guarded.assertTargetIsAllowed('https://1.1.1.1/hook')).resolves.toBeUndefined();
    await expect(service(true).assertTargetIsAllowed('http://127.0.0.1/hook')).resolves.toBeUndefined();
  });

  it('accepts a target whose name does not resolve yet', async () => {
    // A hostname that does not resolve is not proof of a mistake: split-horizon
    // DNS and not-yet-provisioned hosts are normal. The send will report it.
    await expect(
      guarded.assertTargetIsAllowed('https://hooks.invalid-tld-for-tests/hook'),
    ).resolves.toBeUndefined();
  });
});
