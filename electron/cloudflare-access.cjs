// @ts-check

const { spawn } = require('node:child_process');
const { homedir } = require('node:os');
const { join } = require('node:path');
const { findExecutableOnPath, isExecutableFile } = require('./command-utils.cjs');

const CLOUDFLARED_NOT_FOUND_CODE = 'CLOUDFLARED_NOT_FOUND';
const CLOUDFLARED_NOT_FOUND_MESSAGE =
  'Cloudflare Access requires cloudflared. Install cloudflared and verify `cloudflared --version` works in Terminal. Codiff searches PATH, ~/.local/bin/cloudflared, /opt/homebrew/bin/cloudflared, and /usr/local/bin/cloudflared. If cloudflared is installed somewhere else, launch Codiff with `CODIFF_CLOUDFLARED_PATH=/absolute/path/to/cloudflared codiff -w`.';
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const ERROR_DETAIL_LIMIT = 4000;

/** @param {unknown} error */
const getErrorDetail = (error) => {
  if (!error || typeof error !== 'object') {
    return String(error || '').trim();
  }

  const explicitDetail =
    'detail' in error && typeof error.detail === 'string' ? error.detail.trim() : '';
  const detail = explicitDetail || (error instanceof Error ? error.message : String(error));
  return detail.trim().slice(0, ERROR_DETAIL_LIMIT);
};

/**
 * @param {string} message
 * @param {unknown} error
 * @param {unknown} [previousError]
 */
const createAccessError = (message, error, previousError) => {
  const detail = getErrorDetail(error);
  const previousDetail = getErrorDetail(previousError);
  const details = [
    detail ? `cloudflared: ${detail}` : '',
    previousDetail ? `Previous Access token check: ${previousDetail}` : '',
  ].filter(Boolean);
  const wrapped = new Error(details.length > 0 ? `${message}\n${details.join('\n')}` : message, {
    cause: error,
  });
  if (error && typeof error === 'object' && 'code' in error) {
    Object.assign(wrapped, { code: error.code });
  }
  return wrapped;
};

/** @param {string} [detail] */
const createCloudflaredNotFoundError = (detail) =>
  Object.assign(
    new Error(
      detail ? `${CLOUDFLARED_NOT_FOUND_MESSAGE} ${detail}` : CLOUDFLARED_NOT_FOUND_MESSAGE,
    ),
    { code: CLOUDFLARED_NOT_FOUND_CODE },
  );

const getCloudflaredCommand = () => {
  const configuredPath = process.env.CODIFF_CLOUDFLARED_PATH?.trim();
  if (configuredPath) {
    if (isExecutableFile(configuredPath)) {
      return configuredPath;
    }

    throw createCloudflaredNotFoundError(
      `CODIFF_CLOUDFLARED_PATH is set to ${JSON.stringify(configuredPath)}, but that file is not executable.`,
    );
  }

  const pathCommand = findExecutableOnPath('cloudflared');
  if (pathCommand) {
    return pathCommand;
  }

  for (const path of [
    join(homedir(), '.local/bin/cloudflared'),
    '/opt/homebrew/bin/cloudflared',
    '/usr/local/bin/cloudflared',
  ]) {
    if (isExecutableFile(path)) {
      return path;
    }
  }

  throw createCloudflaredNotFoundError();
};

/**
 * @param {Array<string>} args
 * @param {{timeoutMs?: number}} [options]
 */
const runCloudflared = (args, { timeoutMs = COMMAND_TIMEOUT_MS } = {}) =>
  new Promise((resolve, reject) => {
    let command;
    try {
      command = getCloudflaredCommand();
    } catch (error) {
      reject(error);
      return;
    }

    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      const error = new Error(
        `cloudflared ${args.slice(0, 2).join(' ')} timed out after ${Math.round(
          timeoutMs / 1000,
        )} seconds.`,
      );
      Object.assign(error, {
        code: 'CLOUDFLARED_TIMEOUT',
        detail: [error.message, stderr.trim()].filter(Boolean).join('\n'),
      });
      settle(error);
    }, timeoutMs);

    /** @param {Error | null} error */
    const settle = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
      } else {
        resolve(stdout.trim());
      }
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      settle(
        /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT'
          ? createCloudflaredNotFoundError()
          : error,
      );
    });
    child.once('close', (code) => {
      if (code === 0) {
        settle(null);
        return;
      }

      const detail = stderr.trim();
      const error = new Error(
        `cloudflared ${args.slice(0, 2).join(' ')} failed with exit code ${code}.`,
      );
      Object.assign(error, {
        code: 'CLOUDFLARED_FAILED',
        detail: [error.message, detail].filter(Boolean).join('\n'),
        exitCode: code,
      });
      settle(error);
    });
  });

/** @param {unknown} error */
const isCloudflaredNotFoundError = (error) =>
  Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error.code === CLOUDFLARED_NOT_FOUND_CODE || error.code === 'ENOENT'),
  );

/**
 * @param {{
 *   fetchImpl?: typeof fetch;
 *   runCommand?: typeof runCloudflared;
 *   serviceUrl: string;
 * }} options
 */
const createCloudflareAccessClient = ({
  fetchImpl = fetch,
  runCommand = runCloudflared,
  serviceUrl,
}) => {
  const baseUrl = serviceUrl.replace(/\/+$/, '');
  const serviceOrigin = new URL(baseUrl).origin;
  /** @type {Promise<void> | null} */
  let authentication = null;
  let token = '';

  const readToken = async () => {
    const result = await runCommand(['access', 'token', baseUrl], { timeoutMs: 30_000 });
    if (!result.trim()) {
      throw new Error('Cloudflare Access did not return an authentication token.');
    }
    return result.trim();
  };

  const authenticate = async () => {
    if (token) {
      return;
    }
    if (authentication) {
      return authentication;
    }

    authentication = (async () => {
      let tokenError;
      try {
        token = await readToken();
        return;
      } catch (error) {
        if (isCloudflaredNotFoundError(error)) {
          throw error;
        }
        tokenError = error;
      }

      try {
        await runCommand(['access', 'login', '--quiet', '--auto-close', baseUrl]);
      } catch (error) {
        if (isCloudflaredNotFoundError(error)) {
          throw error;
        }
        throw createAccessError(
          'Cloudflare Access browser sign-in did not complete.',
          error,
          tokenError,
        );
      }

      try {
        token = await readToken();
      } catch (error) {
        if (isCloudflaredNotFoundError(error)) {
          throw error;
        }
        throw createAccessError(
          'Cloudflare Access sign-in finished, but no authentication token was available.',
          error,
          tokenError,
        );
      }
    })().finally(() => {
      authentication = null;
    });

    return authentication;
  };

  /** @type {typeof fetch} */
  const authenticatedFetch = async (input, init) => {
    if (!token) {
      throw new Error('Cloudflare Access authentication is required before sharing.');
    }

    const requestUrl = new URL(
      typeof input === 'string' || input instanceof URL ? input : input.url,
    );
    if (requestUrl.origin !== serviceOrigin) {
      throw new Error('Cloudflare Access refused to send credentials to another origin.');
    }

    const headers = new Headers(
      init?.headers ||
        (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined),
    );
    headers.set('cf-access-token', token);
    return fetchImpl(input, { ...init, headers });
  };

  return {
    authenticate,
    clear: () => {
      token = '';
    },
    fetch: authenticatedFetch,
  };
};

module.exports = { createCloudflareAccessClient };
