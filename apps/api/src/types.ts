export type Bindings = {
  PLATFORM_ENV: 'test' | 'production';
  CONTENT_DB: D1Database;
};

export type ApiVariables = {
  requestId: string;
};
