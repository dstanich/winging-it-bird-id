import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { FtpSrv, instances } = vi.hoisted(() => {
  const instances = [];
  const FtpSrv = vi.fn();
  return { FtpSrv, instances };
});

vi.mock('ftp-srv', () => ({ FtpSrv }));

const { startFtpListener } = await import('../lib/ftp-listener.js');

/** Minimal stand-in for an ftp-srv server: an EventEmitter with listen/close. */
class FakeFtpServer extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.listen = vi.fn().mockResolvedValue();
    this.close = vi.fn().mockResolvedValue();
  }
}

/** Emits a login event and returns how the handler settled it. */
const attemptLogin = (server, credentials) => {
  const resolve = vi.fn();
  const reject = vi.fn();
  server.emit('login', credentials, resolve, reject);
  return { resolve, reject };
};

describe('startFtpListener', () => {
  beforeEach(() => {
    instances.length = 0;
    FtpSrv.mockReset();
    FtpSrv.mockImplementation(function (options) {
      const server = new FakeFtpServer(options);
      instances.push(server);
      return server;
    });
  });

  it('configures the server with defaults and disables anonymous login', async () => {
    await startFtpListener({ uploadDir: '/uploads' });

    expect(FtpSrv).toHaveBeenCalledExactlyOnceWith({
      url: 'ftp://0.0.0.0:2121',
      pasv_url: undefined,
      pasv_min: 30100,
      pasv_max: 30110,
      anonymous: false,
      greeting: ['Winging It Bird ID FTP upload'],
    });
  });

  it('passes through host, port, and passive-mode options', async () => {
    await startFtpListener({
      uploadDir: '/uploads',
      host: '127.0.0.1',
      port: 2222,
      pasvUrl: '192.168.1.50',
      pasvMin: 40000,
      pasvMax: 40010,
    });

    expect(FtpSrv.mock.calls[0][0]).toMatchObject({
      url: 'ftp://127.0.0.1:2222',
      pasv_url: '192.168.1.50',
      pasv_min: 40000,
      pasv_max: 40010,
    });
  });

  it('starts listening before resolving and returns the server', async () => {
    const result = await startFtpListener({ uploadDir: '/uploads' });
    const [server] = instances;
    expect(server.listen).toHaveBeenCalledOnce();
    expect(result.server).toBe(server);
  });

  it('close() closes the underlying server', async () => {
    const { close } = await startFtpListener({ uploadDir: '/uploads' });
    await close();
    expect(instances[0].close).toHaveBeenCalledOnce();
  });

  it('propagates listen failures', async () => {
    FtpSrv.mockImplementation(function (options) {
      const server = new FakeFtpServer(options);
      server.listen.mockRejectedValue(new Error('EADDRINUSE'));
      return server;
    });
    await expect(startFtpListener({ uploadDir: '/uploads' })).rejects.toThrow('EADDRINUSE');
  });

  describe('login with credentials configured', () => {
    let server;

    beforeEach(async () => {
      ({ server } = await startFtpListener({ uploadDir: '/uploads', username: 'camera', password: 's3cret' }));
    });

    it('accepts matching credentials and roots the session at uploadDir', () => {
      const { resolve, reject } = attemptLogin(server, { username: 'camera', password: 's3cret' });
      expect(resolve).toHaveBeenCalledExactlyOnceWith({ root: '/uploads' });
      expect(reject).not.toHaveBeenCalled();
    });

    it.each([
      ['wrong password', { username: 'camera', password: 'nope' }],
      ['wrong username', { username: 'someone', password: 's3cret' }],
      ['missing password', { username: 'camera' }],
    ])('rejects a %s', (_label, credentials) => {
      const { resolve, reject } = attemptLogin(server, credentials);
      expect(reject).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'Invalid username or password' }));
      expect(resolve).not.toHaveBeenCalled();
    });
  });

  it('accepts any login when no username is configured', async () => {
    const { server } = await startFtpListener({ uploadDir: '/uploads' });
    const { resolve, reject } = attemptLogin(server, { username: 'anyone', password: 'anything' });
    expect(resolve).toHaveBeenCalledExactlyOnceWith({ root: '/uploads' });
    expect(reject).not.toHaveBeenCalled();
  });

  it('logs client errors without throwing', async () => {
    const { server } = await startFtpListener({ uploadDir: '/uploads' });
    server.emit('client-error', { context: 'RETR', error: new Error('socket hang up') });
    server.emit('client-error', { context: 'STOR', error: 'plain string error' });
    expect(console.error).toHaveBeenCalledWith('FTP client error (RETR):', 'socket hang up');
    expect(console.error).toHaveBeenCalledWith('FTP client error (STOR):', 'plain string error');
  });
});
