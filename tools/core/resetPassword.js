const crypto = require('crypto');
const axios = require('axios');

function normEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function ensureResetTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      organizacion_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_password_resets_email_org ON password_resets (email, organizacion_id);
    CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets (token_hash);
  `);
}

async function sendResetWebhook(payload) {
  const url = process.env.PASSWORD_RESET_WEBHOOK_URL;
  if (!url) return;
  const secret = process.env.PASSWORD_RESET_WEBHOOK_SECRET;
  await axios.post(url, payload, {
    timeout: 8000,
    headers: secret ? { 'X-Webhook-Secret': secret } : undefined,
  });
}

module.exports = {
  name: 'core.reset_password',
  module: 'core',
  action: 'reset_password',
  required: ['email'],
  async plan({ input, context, db }) {
    const email = normEmail(input.email);
    if (!email) {
      return { status: 'question', question: 'Necesito el email del usuario.' };
    }

    const { rows } = await db.query(
      `SELECT 1 FROM usuarios WHERE email = $1 AND organizacion_id = $2 LIMIT 1`,
      [email, context.orgId]
    );
    if (!rows?.length) {
      return { status: 'error', message: 'No encontre un usuario con ese email en esta organizacion.' };
    }

    return {
      status: 'ok',
      preview: { email, accion: 'resetear password' },
      message: `Voy a enviar un reset de password a ${email}.`,
      steps: ['Genero un link seguro', 'Envio el email', 'El usuario define nueva password'],
    };
  },
  async execute({ input, context, db }) {
    const email = normEmail(input.email);
    const orgIdRaw = context.orgId;
    const orgId = Number.isFinite(Number(orgIdRaw)) ? Number(orgIdRaw) : orgIdRaw;

    await ensureResetTable(db);

    await db.query(
      `UPDATE password_resets
          SET used_at = now()
        WHERE email = $1 AND organizacion_id = $2 AND used_at IS NULL`,
      [email, orgId]
    );

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const ttlMin = Number(process.env.PASSWORD_RESET_TTL_MIN || 60);
    const expiresAt = new Date(Date.now() + ttlMin * 60 * 1000);

    await db.query(
      `INSERT INTO password_resets (email, organizacion_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [email, orgId, tokenHash, expiresAt]
    );

    const base = process.env.PASSWORD_RESET_URL_BASE || null;
    const resetUrl = base
      ? `${String(base).replace(/\/+$/, '')}?token=${encodeURIComponent(token)}&email=${encodeURIComponent(
          email
        )}&org=${encodeURIComponent(String(orgId))}`
      : null;

    await sendResetWebhook({
      email,
      organizacion_id: orgId,
      reset_url: resetUrl,
      token,
      expires_at: expiresAt.toISOString(),
    }).catch((err) => {
      if (process.env.NODE_ENV !== 'production') {
        console.error('[reset webhook]', err?.message || err);
      }
    });

    return {
      status: 'ok',
      result: { email },
      message: `Listo. Se envio el reset de password a ${email}.`,
    };
  },
};
