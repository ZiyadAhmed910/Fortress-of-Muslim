export type Bindings = {
  PLATFORM_ENV: 'test' | 'production';
  CONTENT_DB: D1Database;
  AI: Ai;
  VECTOR_INDEX: VectorizeIndex;
  INDEXING_SECRET?: string;
  AUTH: Fetcher & {
    verifyApiKey(key: string, permissions?: Record<string, string[]>): Promise<{
      valid: boolean;
      key: { id: string; referenceId: string } | null;
      error: { code: string; message: string } | null;
    }>;
    verifyBearerToken(token: string, scopes?: string[], audience?: 'api' | 'mcp'): Promise<{
      valid: boolean;
      subject?: string;
      clientId?: string;
      scopes?: string[];
      error?: string;
      ownerUserId?: string;
    }>;
    recordUsage(event: {
      userId?: string;
      credentialId?: string;
      service: string;
      route: string;
      statusCode: number;
      durationMs: number;
      requestUnits?: number;
    }): Promise<void>;
    getNamedQuery(id: string, ownerUserId: string): Promise<{
      id: string;
      ownerUserId: string;
      operation: 'list' | 'search' | 'get_by_id';
      parameters: { query?: string; duaId?: string; limit?: number };
      queryKind?: 'legacy' | 'record_query';
      objectName?: 'duas';
      selectedFields?: string[];
      filters?: Array<{ field: string; operator: string; source: 'literal' | 'parameter'; value: string }>;
      sort?: { field: string; direction: 'asc' | 'desc' };
      parameterSchema?: Array<{ name: string; type: 'string' | 'number'; required: boolean }>;
      maxRows?: number;
    } | null>;
    getServiceState(serviceKey: string): Promise<{
      serviceKey: string;
      status: 'active' | 'maintenance' | 'disabled';
      message: string;
      enforcement: 'worker' | 'external' | 'none';
    }>;
    checkRateLimit(credential: string): Promise<
      | { valid: false }
      | {
          valid: true;
          principalId: string;
          planCode: string;
          allowed: boolean;
          limit: { perMinute: number; perDay: number };
          remaining: { perMinute: number; perDay: number };
          retryAfterSeconds?: number;
        }
    >;
  };
};

export type ApiVariables = {
  requestId: string;
  activeDatasetId: string;
  principalId: string;
  credentialId: string;
};
