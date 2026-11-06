-- 0012: the columns Better Auth 1.7.18's OAuth provider expects on oauthClient.
--
-- Upgrading from 1.7.0-rc.1 (a security upgrade: the release candidate pulled vitest, vite and
-- tinypool in as runtime dependencies) adds three fields to the client model. All three are
-- optional, so existing clients keep working with them empty; Better Auth writes them for clients
-- it creates or updates from here on. test/better-auth-schema.test.ts found them -- it compares every
-- table and column Better Auth needs, as the platform configures it, with the schema these
-- migrations build -- and fails the build if a future upgrade needs another.
--
-- clientCredentialsScopes is a list; like "scopes" above it is stored as text.

ALTER TABLE "oauthClient" ADD COLUMN "clientDiscoveryId" text;
ALTER TABLE "oauthClient" ADD COLUMN "clientCredentialsScopes" text;
ALTER TABLE "oauthClient" ADD COLUMN "applicationType" text;
