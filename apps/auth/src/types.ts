export type AuthEnvironment = 'test' | 'production';

export type Bindings = {
  IDENTITY_DB: D1Database;
  CONTENT_DB: D1Database;
  PLATFORM_ENV: AuthEnvironment;
  AUTH_BASE_URL: string;
  DEVELOPERS_URL: string;
  ADMIN_URL: string;
  API_AUDIENCE: string;
  MCP_AUDIENCE: string;
  BETTER_AUTH_SECRET: string;
};

export type ServiceState = {
  serviceKey: string;
  status: 'active' | 'maintenance' | 'disabled';
  message: string;
  enforcement: 'worker' | 'external' | 'none';
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

export type NamedQueryDefinition = {
  id: string;
  ownerUserId: string;
  operation: 'list' | 'search' | 'get_by_id';
  parameters: { query?: string; duaId?: string; limit?: number };
};
