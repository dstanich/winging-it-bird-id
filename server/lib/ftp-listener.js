/**
 * FTP upload listener - pure trigger-free plumbing, knows nothing about
 * clips/thumbnails/AI. Accepts the Reolink camera's FTP uploads and writes
 * them to disk.
 */

import { FtpSrv } from 'ftp-srv';

/**
 * @param {Object} options
 * @param {string} options.uploadDir - directory FTP uploads are written to (mapped as the FTP root)
 * @param {string} [options.host] - default '0.0.0.0'
 * @param {number} [options.port] - default 2121
 * @param {string} [options.username]
 * @param {string} [options.password]
 * @param {string} [options.pasvUrl] - public/LAN IP clients should use for passive-mode data connections
 * @param {number} [options.pasvMin] - default 30100
 * @param {number} [options.pasvMax] - default 30110
 * @returns {Promise<Object>} { server, close }
 */
export async function startFtpListener(options = {}) {
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
