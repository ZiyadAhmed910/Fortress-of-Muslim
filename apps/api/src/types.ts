export type Bindings = {
  PLATFORM_ENV: 'test' | 'production';
  CONTENT_DB: D1Database;
  AUTH: Fetcher & {
    verifyApiKey(key: string, permissions?: Record<string, string[]>): Promise<{
      valid: boolean;
      key: { id: string; referenceId: string } | null;
      error: { code: string; message: string } | null;
    }>;
    verifyBearerToken(token: string, scopes?: string[]): Promise<{
      valid: boolean;
      subject?: string;
      clientId?: string;
      scopes?: string[];
      error?: string;
    }>;
  };
};

export type ApiVariables = {
  requestId: string;
  principalId: string;
  credentialId: string;
};
