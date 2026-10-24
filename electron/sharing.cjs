// @ts-check

const CLOUDFLARE_EMAIL_SUFFIX = '@cloudflare.com';
const CLOUDFLARE_SHARE_SERVER_URL = 'https://codiff.cloudflare.dev';
const PUBLIC_SHARE_SERVER_URL = 'https://codiff.dev';

/** @param {string | undefined} email */
const isCloudflareEmail = (email) =>
  typeof email === 'string' && email.trim().toLowerCase().endsWith(CLOUDFLARE_EMAIL_SUFFIX);

/**
 * @param {{
 *   email?: string;
 *   forcePublic?: boolean;
 *   overrideUrl?: string;
 * }} options
 */
const resolvePlanShareTarget = ({ email, forcePublic = false, overrideUrl }) => {
  const serviceUrlOverride = overrideUrl?.trim().replace(/\/+$/, '');

  if (!forcePublic && isCloudflareEmail(email)) {
    return {
      authenticated: !serviceUrlOverride,
      internal: true,
      serviceUrl: serviceUrlOverride || CLOUDFLARE_SHARE_SERVER_URL,
    };
  }

  return {
    authenticated: false,
    internal: false,
    serviceUrl: serviceUrlOverride || PUBLIC_SHARE_SERVER_URL,
  };
};

module.exports = {
  resolvePlanShareTarget,
};
