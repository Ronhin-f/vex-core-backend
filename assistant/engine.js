const crypto = require('crypto');
const { getTool } = require('./registry');
const { canPerform } = require('./policy');
const { getSummary } = require('./summaries');
const { resolveModuleConfig, joinUrl } = require('./remote');

const CONFIRM_TTL_MIN = Number(process.env.ASSISTANT_CONFIRM_TTL_MIN || 15);
const PENDING_TTL_MIN = Number(process.env.ASSISTANT_PENDING_TTL_MIN || 10);

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

function extractQuoted(text) {
  const m = text.match(/["']([^"']+)["']/);
  return m ? m[1].trim() : null;
}

function extractPhone(text) {
  const m = text.match(/(\+?\d[\d\s\-()]{6,})/);
  if (!m) return null;
  return m[1].trim();
}

function extractRole(text) {
  if (/\\bowner\\b/.test(text)) return 'owner';
  if (/\\badmin\\b/.test(text)) return 'admin';
  if (/\\buser\\b/.test(text) || /\\busuario\\b/.test(text)) return 'user';
  return null;
}

function extractTaskTitle(text) {
  const quoted = extractQuoted(text);
  if (quoted) return quoted;

  const m = text.match(/tarea\\s+(?:llamada\\s+)?([a-z0-9 \-_]{3,})/i);
  if (m) return m[1].trim();

  const a = text.match(/(completa|completar|marca|marcar)\\s+(?:la\\s+)?(?:tarea\\s+)?(.+)/i);
  if (a) {
    const raw = a[2].replace(/\\b(hecha|lista)\\b/i, '').trim();
    if (raw.length >= 2) return raw;
  }

  return null;
}

function extractClientName(text) {
  const quoted = extractQuoted(text);
  if (quoted) return quoted;

  const m = text.match(/cliente\\s+(?:nuevo\\s+)?(?:llamado\\s+)?([a-z0-9 \-_]{3,})/i);
  if (m) {
    const raw = m[1].trim();
    const cut = raw.split(/\\b(email|telefono|tel|estado|stage)\\b/i)[0];
    return cut.trim() || raw;
  }

  const move = text.match(/(?:mover|pasar)\\s+(.+?)\\s+(?:a|al)\\s+/i);
  if (move) {
    const raw = move[1].trim();
    if (raw.length >= 2) return raw;
  }

  return null;
}

function extractProductName(text) {
  const quoted = extractQuoted(text);
  if (quoted) return quoted.trim();

  const m = text.match(/producto\\s+(?:nuevo\\s+)?(?:llamado\\s+)?([a-z0-9 \-_]{3,})/i);
  if (m) return m[1].trim();

  const a = text.match(/(?:movimiento|traslado|entrada|salida)\\s+(?:de\\s+)?([a-z0-9 \-_]{3,})/i);
  if (a) {
    const raw = a[1].trim();
    if (/[a-z]/i.test(raw)) return raw;
  }

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

function missingQuestion(field, toolName) {
  if (field === 'nombre') {
    if (toolName === 'crm.create_client') return 'Como se llama el cliente?';
    if (toolName === 'stock.create_product') return 'Como se llama el producto?';
    return 'Como se llama?';
  }

  const map = {
    email: 'Necesito el email del usuario.',
    rol: 'Que rol queres? (admin o user)',
    task_id: 'Necesito el id de la tarea.',
    lead_id: 'Necesito el id del lead.',
    stage: 'A que estado queres pasar el lead? (por ejemplo: Qualified, Won, Lost)',
    almacen_id: 'Necesito el id del almacen para crear el producto.',
    producto_id: 'Necesito el id del producto.',
    almacen_origen: 'Necesito el id del almacen de origen.',
    almacen_destino: 'Necesito el id del almacen de destino.',
    cantidad: 'Cuanta cantidad?',
    nombre_cliente: 'Como se llama el cliente?',
  };
  return map[field] || 'Necesito mas datos para seguir.';
}

function wantsCapabilities(text) {
  return (
    text.includes('que podes hacer') ||
    text.includes('que puedes hacer') ||
    text.includes('acciones disponibles') ||
    text.includes('tareas realizables') ||
    text.includes('ayuda') ||
    text.includes('help')
  );
}

function wantsCreateClient(text) {
  if (
    text.includes('crear') ||
    text.includes('crea') ||
    text.includes('agregar') ||
    text.includes('agrega') ||
    text.includes('nuevo') ||
    text.includes('alta')
  ) {
    if (text.includes('cliente') || text.includes('lead')) return true;
  }
  if (text.includes('como') && (text.includes('cliente') || text.includes('lead'))) return true;
  return false;
}

function wantsStockTasks(text) {
  return text.includes('tareas') && text.includes('stock');
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

async function createPendingQuestion(db, data) {
  const expiresAt = new Date(Date.now() + PENDING_TTL_MIN * 60 * 1000);

  await db.query(
    `INSERT INTO assistant_pending_questions
      (organizacion_id, user_id, user_email, module, tool_name, missing_field, inputs_json, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [
      data.orgId,
      data.userId || null,
      data.userEmail || null,
      data.moduleName || null,
      data.toolName || null,
      data.missingField || null,
      JSON.stringify(data.inputs || {}),
      expiresAt,
    ]
  );
}

async function loadPendingQuestion(db, data) {
  const { orgId, userId, userEmail } = data;
  if (!orgId || (!userId && !userEmail)) return null;

  const { rows } = await db.query(
    `SELECT *
       FROM assistant_pending_questions
      WHERE organizacion_id = $1
        AND status = 'pending'
        AND (
          (user_email IS NOT NULL AND user_email = $2) OR
          (user_id IS NOT NULL AND user_id = $3)
        )
      ORDER BY created_at DESC
      LIMIT 1`,
    [orgId, userEmail || null, userId || null]
  );

  const row = rows[0] || null;
  if (!row) return null;

  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    await db.query(
      `UPDATE assistant_pending_questions
          SET status = 'expired', resolved_at = now()
        WHERE id = $1`,
      [row.id]
    );
    return null;
  }

  return row;
}

async function markQuestionResolved(db, id) {
  await db.query(
    `UPDATE assistant_pending_questions
        SET status = 'resolved', resolved_at = now()
      WHERE id = $1`,
    [id]
  );
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
  if (text.includes('tareas realizables') || (text.includes('tareas') && text.includes('hoy'))) {
    return { type: 'summary', summaryType: 'top5_today' };
  }
  if (wantsCapabilities(text)) {
    return { type: 'info', infoType: 'capabilities' };
  }
  if (wantsCreateClient(text)) {
    return {
      type: 'action',
      toolName: 'crm.create_client',
      inputs: {
        nombre: extractClientName(text),
        contacto_nombre: extractClientName(text),
        email: extractEmail(text),
        telefono: extractPhone(text),
      },
    };
  }
  if (wantsStockTasks(text)) {
    return { type: 'info', infoType: 'stock_tasks' };
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

  if (text.includes('tarea') && (text.includes('hecha') || text.includes('completa') || text.includes('listo') || text.includes('marcar') || text.includes('marca'))) {
    return {
      type: 'action',
      toolName: 'crm.mark_task_done',
      inputs: {
        task_id: extractId(text, 'tarea') || entityContext.taskId || null,
        task_title: extractTaskTitle(text),
      },
    };
  }

  const stage = extractStage(text);
  if ((text.includes('lead') || text.includes('cliente') || text.includes('mover') || text.includes('pasar')) && (text.includes('estado') || text.includes('stage') || stage)) {
    return {
      type: 'action',
      toolName: 'crm.change_lead_status',
      inputs: {
        lead_id: extractId(text, 'lead') || extractId(text, 'cliente') || entityContext.leadId || null,
        lead_name: extractClientName(text),
        stage,
      },
    };
  }

  if (
    (text.includes('crear') || text.includes('crea') || text.includes('agregar') || text.includes('agrega') || text.includes('nuevo')) &&
    text.includes('producto')
  ) {
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
        producto_nombre: extractProductName(text),
        cantidad: extractQuantity(text),
        almacen_origen: origen,
        almacen_destino: destino,
      },
    };
  }

  return { type: 'help' };
}

function applyPendingInput(pending, message) {
  const inputs = typeof pending.inputs_json === 'string' ? JSON.parse(pending.inputs_json) : (pending.inputs_json || {});
  const field = pending.missing_field;
  const toolName = pending.tool_name;
  const raw = String(message || '').trim();

  if (!raw) return { ok: false, inputs };

  const numberFromText = (text) => {
    const m = String(text || '').match(/(\d+)/);
    return m ? Number(m[1]) : null;
  };

  let value = null;

  if (field === 'email') value = extractEmail(raw);
  else if (field === 'rol') value = extractRole(raw);
  else if (field === 'stage') value = extractStage(raw) || raw;
  else if (field === 'lead_id') value = extractId(raw, 'lead') || extractId(raw, 'cliente') || numberFromText(raw);
  else if (field === 'task_id') value = extractId(raw, 'tarea') || numberFromText(raw);
  else if (field === 'producto_id') value = extractId(raw, 'producto') || numberFromText(raw);
  else if (field === 'almacen_id') value = extractWarehouseId(raw, 'almacen') || extractWarehouseId(raw, 'deposito') || numberFromText(raw);
  else if (field === 'almacen_origen') value = extractWarehouseId(raw, 'origen') || extractWarehouseId(raw, 'almacen') || numberFromText(raw);
  else if (field === 'almacen_destino') value = extractWarehouseId(raw, 'destino') || extractWarehouseId(raw, 'almacen') || numberFromText(raw);
  else if (field === 'cantidad') value = extractQuantity(raw);
  else if (field === 'nombre') {
    if (toolName === 'crm.create_client') value = extractClientName(raw);
    else if (toolName === 'stock.create_product') value = extractProductName(raw);
    else value = extractQuoted(raw) || raw;
  } else if (field === 'nombre_cliente') value = extractClientName(raw);
  else value = extractQuoted(raw) || raw;

  if (!value) return { ok: false, inputs };

  return { ok: true, inputs: { ...inputs, [field]: value } };
}

async function handleInfo(intent, context) {
  if (intent.infoType === 'capabilities') {
    return {
      type: 'message',
      text:
        'Puedo: invitar usuarios, reenviar invitaciones, resetear password, marcar tareas hechas, mover leads, crear productos, registrar movimientos y generar resumenes.',
    };
  }

  if (intent.infoType === 'create_client') {
    const cfg = await resolveModuleConfig(context.db, 'crm');
    return {
      type: 'message',
      text:
        'Todavia no puedo crear clientes desde el asistente. Hacelo desde Clientes: 1) Abrir Clientes 2) Nuevo cliente 3) Completar datos y guardar.',
      deep_link: cfg?.feBase ? joinUrl(cfg.feBase, '/clientes') : null,
    };
  }

  if (intent.infoType === 'stock_tasks') {
    const cfg = await resolveModuleConfig(context.db, 'stock');
    return {
      type: 'message',
      text:
        'No hay tareas de Stock en CRM. Si queres ver stock o movimientos, entra a Vex Stock.',
      deep_link: cfg?.feBase ? joinUrl(cfg.feBase, '/') : null,
    };
  }

  return {
    type: 'message',
    text: 'Decime que queres hacer.',
  };
}

async function handleAction(intent, context) {
  const tool = getTool(intent.toolName);
  if (!tool) {
    return { type: 'error', text: 'Accion no disponible.' };
  }

  const missing = (tool.required || []).filter((field) => !intent.inputs?.[field]);
  if (missing.length > 0) {
    const missingField = missing[0];
    await createPendingQuestion(context.db, {
      orgId: context.orgId,
      userId: context.user?.id || null,
      userEmail: context.user?.email || null,
      moduleName: tool.module,
      toolName: tool.name,
      missingField,
      inputs: intent.inputs || {},
    });
    return { type: 'question', text: missingQuestion(missingField, tool.name) };
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

  const actionInputs = planned.inputs || intent.inputs;

  const confirmToken = await createPendingAction(context.db, {
    orgId: context.orgId,
    userId: context.user?.id || null,
    userEmail: context.user?.email || null,
    moduleName: tool.module,
    toolName: tool.name,
    inputs: actionInputs,
    preview: planned.preview || {},
  });

  await insertAuditLog(context.db, {
    orgId: context.orgId,
    userId: context.user?.id || null,
    userEmail: context.user?.email || null,
    moduleName: tool.module,
    toolName: tool.name,
    inputs: actionInputs,
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

  const trimmed = String(message || '').trim();
  if (trimmed) {
    const pending = await loadPendingQuestion(context.db, {
      orgId: context.orgId,
      userId: context.user?.id || null,
      userEmail: context.user?.email || null,
    });

    if (pending) {
      const applied = applyPendingInput(pending, trimmed);
      if (!applied.ok) {
        return { type: 'question', text: missingQuestion(pending.missing_field, pending.tool_name) };
      }
      await markQuestionResolved(context.db, pending.id);
      return handleAction({ type: 'action', toolName: pending.tool_name, inputs: applied.inputs }, context);
    }
  }

  const intent = parseIntent(message, context);

  if (intent.type === 'summary') {
    return getSummary(context, intent.summaryType);
  }

  if (intent.type === 'info') {
    return handleInfo(intent, context);
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

