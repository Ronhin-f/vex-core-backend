const crypto = require('crypto');
const axios = require('axios');

function normEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normRole(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'admin' || v === 'owner') return 'admin';
  if (v === 'user' || v === 'usuario') return 'user';
  return null;
}

function buildInviteToken() {
  return crypto.randomBytes(20).toString('hex');
}

async function sendInviteWebhook(payload) {
  const url = process.env.INVITE_WEBHOOK_URL;
  if (!url) return;
  const secret = process.env.INVITE_WEBHOOK_SECRET;
  await axios.post(url, payload, {
    timeout: 8000,
    headers: secret ? { 'X-Webhook-Secret': secret } : undefined,
  });
}

async function findExistingUser(db, orgId, email) {
  const { rows } = await db.query(
    `SELECT 1 FROM usuarios WHERE email = $1 AND organizacion_id = $2 LIMIT 1`,
    [email, orgId]
  );
  return !!rows?.[0];
}

async function loadInvitation(db, orgId, email) {
  const { rows } = await db.query(
    `SELECT id, rol, status, created_at, resent_at
       FROM core_invitaciones
      WHERE organizacion_id = $1 AND email = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [orgId, email]
  );
  return rows?.[0] || null;
}

async function upsertInvitation(db, data) {
  const token = buildInviteToken();
  const now = new Date();
  await db.query(
    `INSERT INTO core_invitaciones
      (organizacion_id, email, rol, invited_by, token, status, created_at, resent_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $6)
     ON CONFLICT (organizacion_id, email)
     DO UPDATE SET
       rol = EXCLUDED.rol,
       invited_by = EXCLUDED.invited_by,
       token = EXCLUDED.token,
       status = 'pending',
       resent_at = EXCLUDED.resent_at`,
    [data.orgId, data.email, data.rol, data.invitedBy, token, now]
  );
  return token;
}

module.exports = {
  name: 'core.invite_user',
  module: 'core',
  action: 'invite_user',
  required: ['email', 'rol'],
  async plan({ input, context, db }) {
    const email = normEmail(input.email);
    const rol = normRole(input.rol);

    if (!email) {
      return { status: 'question', question: 'Necesito el email del usuario.' };
    }
    if (!rol) {
      return { status: 'question', question: 'Que rol queres? (admin o user)' };
    }

    const exists = await findExistingUser(db, context.orgId, email);
    if (exists) {
      return { status: 'error', message: 'Ese usuario ya existe en la organizacion.' };
    }

    const prev = await loadInvitation(db, context.orgId, email);
    const action = prev ? 'reenviar invitacion' : 'crear invitacion';

    return {
      status: 'ok',
      preview: { email, rol, accion: action },
      message: `Voy a ${action} para ${email} con rol ${rol}.`,
      steps: ['Genero la invitacion', 'Envio el link por email', 'Queda pendiente de aceptar'],
    };
  },
  async execute({ input, context, db }) {
    const email = normEmail(input.email);
    const rol = normRole(input.rol);
    const invitedBy = context.user?.email || null;

    const token = await upsertInvitation(db, {
      orgId: context.orgId,
      email,
      rol,
      invitedBy,
    });

    await sendInviteWebhook({
      email,
      rol,
      organizacion_id: context.orgId,
      invited_by: invitedBy,
      token,
    }).catch((err) => {
      if (process.env.NODE_ENV !== 'production') {
        console.error('[invite webhook]', err?.message || err);
      }
    });

    return {
      status: 'ok',
      result: { email, rol },
      message: `Listo. Invitacion enviada a ${email}.`,
    };
  },
};
