import { apiKey } from '@better-auth/api-key';
import { oauthProvider } from '@better-auth/oauth-provider';
import { betterAuth } from 'better-auth';
import { deviceAuthorization, jwt, openAPI, organization } from 'better-auth/plugins';
import type { Bindings } from './types';

export const FORTRESS_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'content:read',
  'content:search',
  'dataset:read',
  'mcp:connect',
  'mcp:manage',
  'apps:read',
  'apps:write',
  'usage:read',
] as const;

export function createAuth(env: Bindings) {
  return betterAuth({
    appName: 'Fortress Platform',
    baseURL: env.AUTH_BASE_URL,
    basePath: '/api/auth',
    database: env.IDENTITY_DB,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.DEVELOPERS_URL, env.ADMIN_URL],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      requireEmailVerification: false,
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 30,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      cookiePrefix: env.PLATFORM_ENV === 'test' ? 'fortress_beta' : 'fortress',
      defaultCookieAttributes: {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
      },
    },
    plugins: [
      organization({ allowUserToCreateOrganization: true }),
      apiKey({
        apiKeyHeaders: ['x-fortress-api-key'],
        defaultPrefix: env.PLATFORM_ENV === 'test' ? 'fom_test_' : 'fom_live_',
        rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 120 },
        permissions: {
          defaultPermissions: {
            content: ['read', 'search'],
            dataset: ['read'],
          },
        },
      }),
      jwt(),
      deviceAuthorization({
        verificationUri: `${env.DEVELOPERS_URL}/device.html`,
        validateClient: async (clientId) => {
          const client = await env.IDENTITY_DB.prepare(
            'SELECT 1 FROM "oauthClient" WHERE "clientId" = ? AND (disabled IS NULL OR disabled = 0)',
          ).bind(clientId).first();
          return Boolean(client);
        },
      }),
      oauthProvider({
        loginPage: `${env.DEVELOPERS_URL}/oauth.html`,
        consentPage: `${env.DEVELOPERS_URL}/oauth.html`,
        scopes: [...FORTRESS_SCOPES],
        validAudiences: [env.API_AUDIENCE, env.MCP_AUDIENCE],
        resources: [
          {
            identifier: env.API_AUDIENCE,
            name: 'Fortress Platform API',
            allowedScopes: ['content:read', 'content:search', 'dataset:read', 'usage:read'],
          },
          {
            identifier: env.MCP_AUDIENCE,
            name: 'Fortress Platform MCP',
            allowedScopes: ['content:read', 'content:search', 'dataset:read', 'mcp:connect', 'mcp:manage'],
          },
        ],
        enforcePerClientResources: false,
        allowDynamicClientRegistration: false,
        allowUnauthenticatedClientRegistration: false,
      }),
      openAPI({ disableDefaultReference: true }),
    ],
  });
}
