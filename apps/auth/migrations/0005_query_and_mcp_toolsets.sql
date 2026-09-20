ALTER TABLE named_queries ADD COLUMN query_kind TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE named_queries ADD COLUMN object_name TEXT NOT NULL DEFAULT 'duas';
ALTER TABLE named_queries ADD COLUMN selected_fields_json TEXT NOT NULL DEFAULT '["id","title","sequence","verificationStatus"]';
ALTER TABLE named_queries ADD COLUMN filters_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE named_queries ADD COLUMN sort_json TEXT NOT NULL DEFAULT '{"field":"sequence","direction":"asc"}';
ALTER TABLE named_queries ADD COLUMN parameter_schema_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE named_queries ADD COLUMN max_rows INTEGER NOT NULL DEFAULT 50;

CREATE TABLE mcp_toolsets (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_user_id, slug)
);

CREATE TABLE mcp_toolset_tools (
  id TEXT PRIMARY KEY,
  toolset_id TEXT NOT NULL REFERENCES mcp_toolsets(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  description TEXT NOT NULL,
  tool_type TEXT NOT NULL CHECK (tool_type IN ('standard', 'named_query', 'external_api')),
  standard_tool_name TEXT,
  named_query_id TEXT REFERENCES named_queries(id) ON DELETE CASCADE,
  external_method TEXT,
  external_url TEXT,
  input_schema_json TEXT NOT NULL DEFAULT '{"type":"object","properties":{}}',
  approval_status TEXT NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('draft', 'review_pending', 'approved', 'rejected')),
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(toolset_id, tool_name)
);

CREATE INDEX mcp_toolsets_owner_idx ON mcp_toolsets(owner_user_id, created_at DESC);
CREATE INDEX mcp_toolset_tools_toolset_idx ON mcp_toolset_tools(toolset_id, enabled);

UPDATE platform_services SET enforcement = 'worker' WHERE service_key = 'mcp';
