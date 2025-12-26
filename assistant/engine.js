const crypto = require('crypto');
const { getTool } = require('./registry');
const { canPerform } = require('./policy');
const { getSummary } = require('./summaries');

const CONFIRM_TTL_MIN = Number(process.env.ASSISTANT_CONFIRM_TTL_MIN || 15);

function normalizeText(input) {
  return String(input || '').toLowerCase();
}

function extractEmail(text) {
  const m = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

function extractId(text, keyword) {
  const re = new RegExp(`${keyword}\\s*#?\\s*(\\d+)`, 'i');
  const m = text.match(re);
  return m ? Number(m[1]) : null;
}

function extractQuantity(text) {
  const byLabel = text.match(/cantidad\\s*#?\\s*(\\d+(\\.\\d+)?)/i);
  if (byLabel) return Number(byLabel[1]);
  const byX = text.match(/\\bx\\s*(\\d+(\\.\\d+)?)/i);
  if (byX) return Number(byX[1]);
  const byNum = text.match(/(\\d+(\\.\\d+)?)/);
  return byNum ? Number(byNum[1]) : null;
}

function extractRole(text) {
  if (/\\bowner\\b/.test(text)) return 'owner';
  if (/\\badmin\\b/.test(text)) return 'admin';
  if (/\\buser\\b/.test(text) || /\\busuario\\b/.test(text)) return 'user';
  return null;
}

function extractProductName(text) {
  const quoted = text.match(/["']([^"']+)["']/);
  if (quoted) return quoted[1].trim();

  const m = text.match(/producto\\s+(?:nuevo\\s+)?(?:llamado\\s+)?([a-z0-9 \\-_]{3,})/i);
  if (m) return m[1].trim();

  return null;
}

function extractWarehouseId(text, label) {
  const re = new RegExp(`${label}\\s*#?\\s*(\\d+)`, 'i');
  const m = text.match(re);
  return m ? Number(m[1]) : null;
}

function extractWarehousePair(text) {
  const byWords = text.match(/desde\\s*(\\d+)\\s*(?:a|hasta|hacia)\\s*(\\d+)/i);
  if (byWords) {
    return { origen: Number(byWords[1]), destino: Number(byWords[2]) };
  }
  return { origen: null, destino: null };
}

function extractStage(text) {
  const quoted = text.match(/estado\\s*[:=]?\\s*["']([^"']+)["']/i);
  if (quoted) return quoted[1].trim();

  if (/(won|ganad)/i.test(text)) return 'Won';
  if (/(lost|perdid)/i.test(text)) return 'Lost';
  if (/(incoming|nuevo|lead nuevo)/i.test(text)) return 'Incoming Leads';
  if (/(qualified|calificad)/i.test(text)) return 'Qualified';
  if (/(follow|seguimiento|follow-up)/i.test(text)) return 'Follow-up Missed';
  if (/(bid|presupuesto|estimate)/i.test(text)) return 'Bid/Estimate Sent';
  if (/(unqualified|no calif)/i.test(text)) return 'Unqualified';
  return null;
}

function missingQuestion(field) {
  const map = {
    email: 'Necesito el email del usuario.',
    rol: 'Que rol queres? (admin o user)',
    task_id: 'Necesito el id de la tarea.',
    lead_id: 'Necesito el id del lead.',
    stage: 'A que estado queres pasar el lead? (por ejemplo: Qualified, Won, Lost)',
    nombre: 'Como se llama el producto?',
    almacen_id: 'Necesito el id del almacen para crear el producto.',
    producto_id: 'Necesito el id del producto.',
    almacen_origen: 'Necesito el id del almacen de origen.',
    almacen_destino: 'Necesito el id del almacen de destino.',
    cantidad: 'Cuanta cantidad?',
  };
  return map[field] || 'Necesito mas datos para seguir.';
}

function safeSummary(value, maxLen = 500) {
  let out = '';
  try {
    out = JSON.stringify(value);
  } catch {
    out = String(value);
  }
  if (out.length > maxLen) return out.slice(0, maxLen) + '...';
  return out;
}

async function insertAuditLog(db, data) {
  const {
    orgId,
    userId,
    userEmail,
    moduleName,
    toolName,
    inputs,
    result,
  } = data;

  await db.query(
    `INSERT INTO ai_audit_log
      (organizacion_id, user_id, user_email, module, tool_name, inputs_resumen, result_resumen)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      orgId,
      userId || null,
      userEmail || null,
      moduleName || null,
      toolName || null,
      safeSummary(inputs),
      safeSummary(result),
    ]
  );
}

async function createPendingAction(db, data) {
  const token = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + CONFIRM_TTL_MIN * 60 * 1000);

  await db.query(
    `INSERT INTO assistant_action_confirmations
      (confirm_token, organizacion_id, user_id, user_email, module, tool_name, inputs_json, preview_json, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
    [
      token,
      data.orgId,
      data.userId || null,
      data.userEmail || null,
      data.moduleName || null,
      data.toolName || null,
      JSON.stringify(data.inputs || {}),
      JSON.stringify(data.preview || {}),
      expiresAt,
    ]
  );

  return token;
}

async function loadPendingAction(db, token, orgId) {
  const { rows } = await db.query(
    `SELECT *
       FROM assistant_action_confirmations
      WHERE confirm_token = $1
        AND organizacion_id = $2
      LIMIT 1`,
    [token, orgId]
  );
  return rows[0] || null;
}

async function markActionExecuted(db, id) {
  await db.query(
    `UPDATE assistant_action_confirmations
        SET status = 'executed', executed_at = now()
      WHERE id = $1`,
    [id]
  );
}

async function isModuleEnabled(db, orgId, moduleName) {
  if (!orgId) return false;
  if (!['crm', 'stock', 'flows'].includes(moduleName)) return true;
  const { rows } = await db.query(
    `SELECT habilitado
       FROM modulos
      WHERE organizacion_id = $1
        AND nombre = $2
      LIMIT 1`,
    [orgId, moduleName]
  );
  return !!rows?.[0]?.habilitado;
}

function parseIntent(message, context) {
  const text = normalizeText(message);
  const entityContext = context.entityContext || {};

  if (!text) return { type: 'help' };

  if (text.includes('resumen') && text.includes('semana')) {
    return { type: 'summary', summaryType: 'weekly' };
  }
  if (text.includes('resumen') && (text.includes('dia') || text.includes('hoy'))) {
    return { type: 'summary', summaryType: 'daily' };
  }
  if (text.includes('atrasad')) {
    return { type: 'summary', summaryType: 'overdue' };
  }
  if (text.includes('vencimiento') || text.includes('vencimientos')) {
    return { type: 'summary', summaryType: 'upcoming' };
  }
  if (text.includes('fria') || text.includes('frio')) {
    return { type: 'summary', summaryType: 'cold_leads' };
  }
  if (text.includes('top 5') || (text.includes('top') && text.includes('hoy'))) {
    return { type: 'summary', summaryType: 'top5_today' };
  }

  if (text.includes('reenviar') && text.includes('invit')) {
    return {
      type: 'action',
      toolName: 'core.resend_invite',
      inputs: { email: extractEmail(text) },
    };
  }

  if ((text.includes('reset') || text.includes('restablecer')) && (text.includes('password') || text.includes('contrasena'))) {
    return {
      type: 'action',
      toolName: 'core.reset_password',
      inputs: { email: extractEmail(text) },
    };
  }

  if (text.includes('invitar') || text.includes('invitacion') || text.includes('invita')) {
    return {
      type: 'action',
      toolName: 'core.invite_user',
      inputs: { email: extractEmail(text), rol: extractRole(text) },
    };
  }

  if (text.includes('tarea') && (text.includes('hecha') || text.includes('completa') || text.includes('listo'))) {
    return {
      type: 'action',
      toolName: 'crm.mark_task_done',
      inputs: { task_id: extractId(text, 'tarea') || entityContext.taskId || null },
    };
  }

  if ((text.includes('lead') || text.includes('cliente')) && (text.includes('estado') || text.includes('stage'))) {
    return {
      type: 'action',
      toolName: 'crm.change_lead_status',
      inputs: {
        lead_id: extractId(text, 'lead') || extractId(text, 'cliente') || entityContext.leadId || null,
        stage: extractStage(text),
      },
    };
  }

  if ((text.includes('crear') || text.includes('nuevo')) && text.includes('producto')) {
    const almacenId = extractWarehouseId(text, 'almacen') || extractWarehouseId(text, 'deposito');
    return {
      type: 'action',
      toolName: 'stock.create_product',
      inputs: { nombre: extractProductName(text), almacen_id: almacenId || entityContext.almacenId || null },
    };
  }

  if (text.includes('movimiento') || text.includes('traslado') || text.includes('entrada') || text.includes('salida')) {
    const pair = extractWarehousePair(text);
    const origen = extractWarehouseId(text, 'origen') || pair.origen || entityContext.almacenOrigenId || null;
    const destino = extractWarehouseId(text, 'destino') || pair.destino || entityContext.almacenDestinoId || null;
    return {
      type: 'action',
      toolName: 'stock.register_movement',
      inputs: {
        producto_id: extractId(text, 'producto') || entityContext.productId || null,
        cantidad: extractQuantity(text),
        almacen_origen: origen,
        almacen_destino: destino,
      },
    };
  }

  return { type: 'help' };
}

async function handleAction(intent, context) {
  const tool = getTool(intent.toolName);
  if (!tool) {
    return { type: 'error', text: 'Accion no disponible.' };
  }

  const missing = (tool.required || []).filter((field) => !intent.inputs?.[field]);
  if (missing.length > 0) {
    return { type: 'question', text: missingQuestion(missing[0]) };
  }

  if (!canPerform(context.user, tool.action, tool.module)) {
    return { type: 'error', text: 'No tenes permisos para eso.' };
  }

  const enabled = await isModuleEnabled(context.db, context.orgId, tool.module);
  if (!enabled) {
    return { type: 'error', text: `El modulo ${tool.module} no esta habilitado en tu organizacion.` };
  }

  const planned = await tool.plan({
    input: intent.inputs,
    context,
    db: context.db,
  });

  if (planned.status === 'question') {
    return { type: 'question', text: planned.question || 'Necesito un dato mas.' };
  }
  if (planned.status === 'error') {
    return { type: 'error', text: planned.message || 'No puedo avanzar con eso.' };
  }

  const confirmToken = await createPendingAction(context.db, {
    orgId: context.orgId,
    userId: context.user?.id || null,
    userEmail: context.user?.email || null,
    moduleName: tool.module,
    toolName: tool.name,
    inputs: intent.inputs,
    preview: planned.preview || {},
  });

  await insertAuditLog(context.db, {
    orgId: context.orgId,
    userId: context.user?.id || null,
    userEmail: context.user?.email || null,
    moduleName: tool.module,
    toolName: tool.name,
    inputs: intent.inputs,
    result: { preview: planned.preview || {} },
  });

  return {
    type: 'action_preview',
    action: tool.name,
    payload_preview: planned.preview || {},
    confirm_token: confirmToken,
    text: planned.message || 'Este es el preview. Queres confirmar?',
    steps: planned.steps || null,
    deep_link: planned.deep_link || null,
  };
}

async function handleConfirmation(confirmToken, context) {
  const row = await loadPendingAction(context.db, confirmToken, context.orgId);
  if (!row) {
    return { type: 'error', text: 'No encontre esa confirmacion.' };
  }

  if (row.status !== 'pending') {
    return { type: 'error', text: 'Esa accion ya fue procesada.' };
  }

  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return { type: 'error', text: 'La confirmacion expiro. Pedi de nuevo.' };
  }

  const userEmail = String(context.user?.email || '').toLowerCase();
  if (row.user_email && String(row.user_email).toLowerCase() !== userEmail) {
    return { type: 'error', text: 'Esa confirmacion no pertenece a tu usuario.' };
  }

  const tool = getTool(row.tool_name);
  if (!tool) {
    return { type: 'error', text: 'La accion ya no esta disponible.' };
  }

  if (!canPerform(context.user, tool.action, tool.module)) {
    return { type: 'error', text: 'No tenes permisos para eso.' };
  }

  const inputs = typeof row.inputs_json === 'string' ? JSON.parse(row.inputs_json) : (row.inputs_json || {});
  const exec = await tool.execute({
    input: inputs,
    context,
    db: context.db,
  });

  if (exec.status === 'error') {
    return { type: 'error', text: exec.message || 'No pude completar la accion.' };
  }

  await markActionExecuted(context.db, row.id);

  await insertAuditLog(context.db, {
    orgId: context.orgId,
    userId: context.user?.id || null,
    userEmail: context.user?.email || null,
    moduleName: tool.module,
    toolName: tool.name,
    inputs,
    result: exec.result || {},
  });

  return {
    type: 'action_result',
    action: tool.name,
    result: exec.result || {},
    text: exec.message || 'Listo, ya lo hice.',
    deep_link: exec.deep_link || null,
  };
}

async function handleChat({ message, confirm_token, context }) {
  if (confirm_token) {
    return handleConfirmation(confirm_token, context);
  }

  const intent = parseIntent(message, context);

  if (intent.type === 'summary') {
    return getSummary(context, intent.summaryType);
  }

  if (intent.type === 'action') {
    return handleAction(intent, context);
  }

  return {
    type: 'message',
    text: 'Decime que queres hacer. Ej: "Invitar usuario email@dominio.com como admin".',
  };
}

module.exports = { handleChat };
