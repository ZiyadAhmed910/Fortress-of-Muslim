type Tool = { name: string; description: string; toolType: 'standard' | 'named_query' | 'external_api'; standardToolName?: string; namedQueryId?: string; externalMethod?: 'GET' | 'POST'; externalUrl?: string; inputSchema: Record<string, unknown> };
type Bindings = {
  PLATFORM_ENV: 'test' | 'production'; AUTH_BASE_URL: string;
  AUTH: Fetcher & {
    verifyBearerToken(token: string, scopes?: string[], audience?: 'api' | 'mcp'): Promise<{ valid: boolean; subject?: string; ownerUserId?: string; error?: string }>;
    getMcpTools(ownerUserId: string, toolsetSlug?: string): Promise<Tool[]>;
    getServiceState(serviceKey: string): Promise<{ status: 'active' | 'maintenance' | 'disabled'; message: string }>;
  };
  API: Fetcher & { executeMcpTool(tool: Tool, args: Record<string, unknown>, ownerUserId: string): Promise<unknown> };
};

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ status: 'ok', service: 'fortress-mcp', environment: env.PLATFORM_ENV, version: '0.10.0', timestamp: new Date().toISOString() });
    if (url.pathname === '/.well-known/oauth-protected-resource') return Response.json({ resource: url.origin, authorization_servers: [`${env.AUTH_BASE_URL}/api/auth`], scopes_supported: ['mcp:connect', 'content:read', 'content:search', 'dataset:read'] });
    if (url.pathname !== '/mcp' || request.method !== 'POST') return Response.json({ error: 'Not found' }, { status: 404 });
    const service = await env.AUTH.getServiceState('mcp');
    if (service.status !== 'active') return Response.json({ error: 'service_unavailable', message: service.message }, { status: 503, headers: { 'Retry-After': '300' } });
    const token = bearer(request.headers.get('Authorization'));
    if (!token) return unauthorized(env, url);
    const verification = await env.AUTH.verifyBearerToken(token, ['mcp:connect'], 'mcp');
    const ownerUserId = verification.ownerUserId ?? verification.subject;
    if (!verification.valid || !ownerUserId) return unauthorized(env, url, verification.error);
    let message: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
    try { message = await request.json(); } catch { return rpc(null, undefined, { code: -32700, message: 'Parse error' }, 400); }
    const toolset = url.searchParams.get('toolset') ?? undefined;
    if (message.method === 'initialize') return rpc(message.id, { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'Fortress Platform MCP', version: '0.10.0' }, instructions: 'Use Fortress tools for dataset-grounded dua content. All tools are read-only. For a named dua or situation, call find_dua first because it fuzzy-matches titles and returns complete records in one call. Use search_duas only for broad searches inside the dua text. Call get_dua_evidence before making authenticity, attribution, or citation claims, and state clearly when evidence is pending or incomplete.' });
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (message.method === 'tools/list') {
      const tools = await env.AUTH.getMcpTools(ownerUserId, toolset);
      return rpc(message.id, { tools: tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: tool.toolType === 'external_api' } })) });
    }
    if (message.method === 'tools/call') {
      const params = message.params ?? {}; const name = String(params.name ?? ''); const args = params.arguments && typeof params.arguments === 'object' ? params.arguments as Record<string, unknown> : {};
      const tools = await env.AUTH.getMcpTools(ownerUserId, toolset); const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) return rpc(message.id, undefined, { code: -32602, message: 'Tool is not available in this Fortress toolset.' });
      try { const result = tool.toolType === 'external_api' ? await executeExternalTool(tool, args) : await env.API.executeMcpTool(tool, args, ownerUserId); return rpc(message.id, { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result }); }
      catch (error) { return rpc(message.id, { content: [{ type: 'text', text: error instanceof Error ? error.message : 'Tool execution failed.' }], isError: true }); }
    }
    return rpc(message.id, undefined, { code: -32601, message: 'Method not found' });
  },
};

function bearer(value: string | null) { return value?.startsWith('Bearer ') ? value.slice(7).trim() : null; }
function unauthorized(env: Bindings, url: URL, description = 'OAuth access token with mcp:connect is required.') { return Response.json({ error: 'unauthorized', error_description: description }, { status: 401, headers: { 'WWW-Authenticate': `Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource", authorization_uri="${env.AUTH_BASE_URL}/api/auth"` } }); }
function rpc(id: unknown, result?: unknown, error?: { code: number; message: string }, status = 200) { return Response.json({ jsonrpc: '2.0', id: id ?? null, ...(error ? { error } : { result }) }, { status, headers: { 'Cache-Control': 'no-store' } }); }
async function executeExternalTool(tool: Tool, args: Record<string, unknown>) { if (!tool.externalUrl || !tool.externalMethod) throw new Error('External tool configuration is incomplete.'); const url=new URL(tool.externalUrl); if(url.protocol!=='https:'||isPrivateHost(url.hostname))throw new Error('External endpoint is not allowed.'); const options:RequestInit={method:tool.externalMethod,headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)}; if(tool.externalMethod==='GET')for(const [key,value] of Object.entries(args))url.searchParams.set(key,String(value));else{(options.headers as Record<string,string>)['Content-Type']='application/json';options.body=JSON.stringify(args);} const response=await fetch(url,options);const text=await response.text();if(text.length>1_000_000)throw new Error('External response exceeded 1 MB.');if(!response.ok)throw new Error(`External API returned ${response.status}.`);try{return JSON.parse(text);}catch{return {text};} }
function isPrivateHost(host:string){return host==='localhost'||host.endsWith('.local')||host.includes(':')||/^127\.|^10\.|^192\.168\.|^169\.254\.|^0\./.test(host)||/^172\.(1[6-9]|2\d|3[01])\./.test(host);}
