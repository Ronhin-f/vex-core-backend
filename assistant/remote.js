const axios = require('axios');

const MODULE_ENV_KEYS = {
  crm: ['VEX_CRM_API_URL', 'CRM_API_URL', 'VEX_CRM_URL', 'CRM_URL'],
  stock: ['VEX_STOCK_API_URL', 'STOCK_API_URL', 'VEX_STOCK_URL', 'STOCK_URL'],
  flows: ['VEX_FLOWS_API_URL', 'FLOWS_API_URL', 'VEX_FLOWS_URL', 'FLOWS_URL'],
};

function cleanBaseUrl(value) {
  if (!value) return null;
  let v = String(value).trim();
  if (!v) return null;
  v = v.replace(/\/+$/, '');
  return v;
}

function pickEnv(keys = []) {
  for (const k of keys) {
    const v = cleanBaseUrl(process.env[k]);
    if (v) return v;
  }
  return null;
}

async function readSystemSetting(db, key) {
  try {
    const r = await db.query('SELECT value FROM system_settings WHERE key = $1 LIMIT 1', [key]);
    return r.rows?.[0]?.value || null;
  } catch {
    return null;
  }
}

function parseSettingValue(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed || null;
    } catch {
      if (/^https?:\/\//i.test(raw)) return { api_base: raw };
      return { raw };
    }
  }
  if (typeof value === 'object') return value;
  return null;
}

function extractApiBase(cfg) {
  if (!cfg) return null;
  if (typeof cfg === 'string') return cfg;
  return cfg.api_base || cfg.api_url || cfg.base_url || cfg.url || null;
}

function extractFeBase(cfg) {
  if (!cfg) return null;
  if (typeof cfg === 'string') return null;
  return cfg.fe_url || cfg.fe_base || cfg.frontend_url || null;
}

async function resolveModuleConfig(db, moduleName) {
  const envBase = pickEnv(MODULE_ENV_KEYS[moduleName] || []);
  const rawCfg = await readSystemSetting(db, moduleName);
  const cfg = parseSettingValue(rawCfg);

  return {
    apiBase: cleanBaseUrl(envBase || extractApiBase(cfg)),
    feBase: cleanBaseUrl(extractFeBase(cfg)),
  };
}

function joinUrl(base, path) {
  const b = cleanBaseUrl(base);
  if (!b) return null;
  if (!path) return b;
  const p = String(path);
  return p.startsWith('/') ? `${b}${p}` : `${b}/${p}`;
}

async function requestJson({
  baseUrl,
  path,
  method = 'GET',
  data,
  params,
  context,
  headers,
  timeoutMs = 8000,
}) {
  const url = joinUrl(baseUrl, path);
  if (!url) throw new Error('missing_api_base');

  const reqHeaders = { Accept: 'application/json', ...(headers || {}) };
  if (context?.authToken) reqHeaders.Authorization = `Bearer ${context.authToken}`;
  if (context?.orgId) reqHeaders['X-Org-Id'] = String(context.orgId);

  const resp = await axios({
    url,
    method,
    data,
    params,
    headers: reqHeaders,
    timeout: timeoutMs,
    validateStatus: (s) => s >= 200 && s < 500,
  });

  if (resp.status >= 400) {
    const err = new Error(`HTTP ${resp.status}`);
    err.status = resp.status;
    err.data = resp.data;
    throw err;
  }
  return resp.data;
}

module.exports = {
  resolveModuleConfig,
  requestJson,
  joinUrl,
};
