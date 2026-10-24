// @ts-check
const { createCloudflareAccessClient } = require('./cloudflare-access.cjs');
const { uploadSharedSnapshot } = require('./shared-upload.cjs');
const { resolvePlanShareTarget } = require('./sharing.cjs');
/**
 * @param {{
 *   codiffVersion: string;
 *   forcePublic?: boolean;
 *   openExternal: (url: string) => Promise<void>;
 *   serviceUrlOverride?: string;
 *   snapshot: Record<string, unknown>;
 *   target?: {authenticated: boolean; internal: boolean; serviceUrl: string};
 *   uploader: {email?: string; name?: string};
 * }} options
 */
const uploadSnapshot = async ({
  codiffVersion,
  forcePublic,
  openExternal,
  serviceUrlOverride,
  snapshot,
  target: targetOverride,
  uploader,
}) => {
  const target =
    targetOverride ||
    resolvePlanShareTarget({
      email: uploader.email,
      forcePublic,
      overrideUrl: serviceUrlOverride,
    });
  if (!target) {
    throw new Error('Sharing is not available for this user.');
  }

  const accessClient = target.authenticated
    ? createCloudflareAccessClient({ serviceUrl: target.serviceUrl })
    : null;

  try {
    return await uploadSharedSnapshot({
      authenticate: accessClient?.authenticate,
      fetchImpl: accessClient?.fetch,
      openClaimPage: false,
      openExternal,
      serviceUrl: target.serviceUrl,
      snapshot: {
        ...snapshot,
        codiffVersion,
        exportedAt: new Date().toISOString(),
      },
      uploader: target.internal ? uploader : undefined,
    });
  } finally {
    accessClient?.clear();
  }
};

module.exports = { uploadSnapshot };
