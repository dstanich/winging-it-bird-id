/**
 * FTP upload listener - pure trigger-free plumbing, knows nothing about
 * clips/thumbnails/AI. Accepts the Reolink camera's FTP uploads and writes
 * them to disk.
 */

import { FtpSrv } from 'ftp-srv';

export interface FtpListenerOptions {
  /** Directory FTP uploads are written to (mapped as the FTP root). */
  uploadDir: string;
  /** Default '0.0.0.0'. */
  host?: string;
  /** Default 2121. */
  port?: number;
  username?: string;
  password?: string;
  /** Public/LAN IP clients should use for passive-mode data connections. */
  pasvUrl?: string;
  /** Default 30100. */
  pasvMin?: number;
  /** Default 30110. */
  pasvMax?: number;
}

export async function startFtpListener(options: FtpListenerOptions): Promise<{ server: FtpSrv; close: () => Promise<unknown> }> {
  const host = options.host || '0.0.0.0';
  const port = options.port || 2121;
  const uploadDir = options.uploadDir;
  const { username, password, pasvUrl, pasvMin = 30100, pasvMax = 30110 } = options;

  const server = new FtpSrv({
    url: `ftp://${host}:${port}`,
    pasv_url: pasvUrl,
    pasv_min: pasvMin,
    pasv_max: pasvMax,
    anonymous: false,
    greeting: ['Winging It Bird ID FTP upload'],
  });

  server.on('login', ({ username: user, password: pass }, resolve, reject) => {
    if (username && (user !== username || pass !== password)) {
      reject(new Error('Invalid username or password'));
      return;
    }
    resolve({ root: uploadDir });
  });

  server.on('client-error', ({ context, error }) => {
    console.error(`FTP client error (${context}):`, error.message || error);
  });

  await server.listen();
  console.log(`FTP upload listener on ${host}:${port} (root=${uploadDir})`);

  return {
    server,
    close: () => server.close(),
  };
}
