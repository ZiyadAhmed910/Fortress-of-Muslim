export type AuthEnvironment = 'test' | 'production';

export type Bindings = {
  IDENTITY_DB: D1Database;
  PLATFORM_ENV: AuthEnvironment;
  AUTH_BASE_URL: string;
  DEVELOPERS_URL: string;
  ADMIN_URL: string;
  API_AUDIENCE: string;
  MCP_AUDIENCE: string;
  BETTER_AUTH_SECRET: string;
};

export type KeyVerification = {
  valid: boolean;
  error: { code: string; message: string } | null;
  key: {
    id: string;
    referenceId: string;
    permissions?: Record<string, string[]> | null;
    metadata?: unknown;
  } | null;
};

export type TokenVerification = {
  valid: boolean;
  subject?: string;
  scopes?: string[];
  clientId?: string;
  error?: string;
};
