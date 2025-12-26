const crypto = require('crypto');
const axios = require('axios');

function normEmail(value) {
  return String(value || '').trim().toLowerCase();
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

async function loadInvitation(db, orgId, email) {
  const { rows } = await db.query(
    `SELECT id, rol, status
       FROM core_invitaciones
      WHERE organizacion_id = $1 AND email = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [orgId, email]
  );
  return rows?.[0] || null;
}

async function updateInvite(db, orgId, email) {
  const token = crypto.randomBytes(20).toString('hex');
  await db.query(
    `UPDATE core_invitaciones
        SET token = $1,
            status = 'pending',
            resent_at = now()
      WHERE organizacion_id = $2 AND email = $3`,
    [token, orgId, email]
  );
  return token;
}

module.exports = {
  name: 'core.resend_invite',
  module: 'core',
  action: 'resend_invite',
  required: ['email'],
  async plan({ input, context, db }) {
    const email = normEmail(input.email);
    if (!email) {
      return { status: 'question', question: 'Necesito el email del usuario.' };
    }

    const invite = await loadInvitation(db, context.orgId, email);
    if (!invite) {
      return { status: 'error', message: 'No encontre una invitacion para ese email.' };
    }

    return {
      status: 'ok',
      preview: { email, rol: invite.rol, accion: 'reenviar invitacion' },
      message: `Voy a reenviar la invitacion a ${email}.`,
      steps: ['Genero un nuevo link', 'Reenvio el email', 'Queda pendiente de aceptar'],
    };
  },
  async execute({ input, context, db }) {
    const email = normEmail(input.email);
    const token = await updateInvite(db, context.orgId, email);

    await sendInviteWebhook({
      email,
      organizacion_id: context.orgId,
      invited_by: context.user?.email || null,
      token,
      resend: true,
    }).catch((err) => {
      if (process.env.NODE_ENV !== 'production') {
        console.error('[invite webhook]', err?.message || err);
      }
    });

    return {
      status: 'ok',
      result: { email },
      message: `Listo. Reenvie la invitacion a ${email}.`,
    };
  },
};
