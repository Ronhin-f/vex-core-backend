const { resolveModuleConfig, requestJson, joinUrl } = require('./remote');

const MAX_ITEMS = 5;

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function inRange(date, from, to) {
  if (!date) return false;
  const t = new Date(date).getTime();
  return t >= from.getTime() && t <= to.getTime();
}

function safeText(v, fallback = '-') {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s ? s : fallback;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickTaskLabel(t) {
  const id = toNum(t?.id);
  const title = safeText(t?.titulo, 'Tarea');
  const due = t?.vence_en ? new Date(t.vence_en).toISOString().slice(0, 10) : null;
  return {
    id,
    title,
    due_at: due,
    cliente: safeText(t?.cliente_nombre, null),
    estado: safeText(t?.estado, null),
  };
}

function pickLeadLabel(l) {
  return {
    id: toNum(l?.id),
    nombre: safeText(l?.nombre, 'Lead'),
    stage: safeText(l?.stage || l?.categoria, null),
    due_date: l?.due_date ? new Date(l.due_date).toISOString().slice(0, 10) : null,
  };
}

function pickMovementLabel(m) {
  return {
    id: toNum(m?.id),
    producto_id: toNum(m?.producto_id),
    cantidad: toNum(m?.cantidad),
    fecha: m?.fecha ? new Date(m.fecha).toISOString().slice(0, 10) : null,
  };
}

async function fetchCrmTasks(context, params) {
  const cfg = await resolveModuleConfig(context.db, 'crm');
  if (!cfg.apiBase) return null;
  return requestJson({
    baseUrl: cfg.apiBase,
    path: '/tareas',
    method: 'GET',
    params,
    context,
  });
}

async function fetchCrmKanbanClientes(context) {
  const cfg = await resolveModuleConfig(context.db, 'crm');
  if (!cfg.apiBase) return null;
  return requestJson({
    baseUrl: cfg.apiBase,
    path: '/kanban/clientes',
    method: 'GET',
    params: { _t: Date.now() },
    context,
  });
}

async function fetchStockMovimientos(context) {
  const cfg = await resolveModuleConfig(context.db, 'stock');
  if (!cfg.apiBase) return null;
  return requestJson({
    baseUrl: cfg.apiBase,
    path: '/movimientos',
    method: 'GET',
    params: { _t: Date.now() },
    context,
  });
}

async function getSummary(context, summaryType) {
  try {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const weekEnd = new Date(todayStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const tasks = await fetchCrmTasks(context, { limit: 200, offset: 0 }).catch(() => null);
    const kanban = await fetchCrmKanbanClientes(context).catch(() => null);
    const movements = await fetchStockMovimientos(context).catch(() => null);

    const tasksList = Array.isArray(tasks) ? tasks : [];
    const leadsColumns = Array.isArray(kanban?.columns) ? kanban.columns : [];
    const movementsList = Array.isArray(movements) ? movements : [];

    const overdueTasks = tasksList.filter((t) => {
      if (t?.completada) return false;
      if (!t?.vence_en) return false;
      return new Date(t.vence_en).getTime() < todayStart.getTime();
    });

    const dueToday = tasksList.filter((t) => inRange(t?.vence_en, todayStart, todayEnd) && !t?.completada);
    const dueWeek = tasksList.filter((t) => inRange(t?.vence_en, todayStart, weekEnd) && !t?.completada);

    const upcomingLeads = [];
    for (const col of leadsColumns) {
      const items = Array.isArray(col?.items) ? col.items : [];
      for (const l of items) {
        if (l?.due_date && inRange(l?.due_date, todayStart, weekEnd)) {
          upcomingLeads.push(l);
        }
      }
    }

    const coldLeads = [];
    for (const col of leadsColumns) {
      const key = String(col?.key || col?.title || '').toLowerCase();
      if (key.includes('follow-up') || key.includes('follow') || key.includes('unqualified')) {
        const items = Array.isArray(col?.items) ? col.items : [];
        coldLeads.push(...items);
      }
    }

    const movesToday = movementsList.filter((m) => inRange(m?.fecha || m?.created_at, todayStart, todayEnd));
    const movesWeek = movementsList.filter((m) => inRange(m?.fecha || m?.created_at, todayStart, weekEnd));

    const crmCfg = await resolveModuleConfig(context.db, 'crm');

    if (summaryType === 'daily') {
      const items = [
        ...dueToday.slice(0, MAX_ITEMS).map(pickTaskLabel),
        ...movesToday.slice(0, MAX_ITEMS).map(pickMovementLabel),
      ];
      return {
        type: 'summary',
        summary_type: 'daily',
        text: `Resumen de hoy: ${dueToday.length} tareas vencen hoy y ${movesToday.length} movimientos de stock.`,
        items,
        deep_link: crmCfg?.feBase ? joinUrl(crmCfg.feBase, '/tareas') : null,
      };
    }

    if (summaryType === 'weekly') {
      const items = [
        ...dueWeek.slice(0, MAX_ITEMS).map(pickTaskLabel),
        ...movesWeek.slice(0, MAX_ITEMS).map(pickMovementLabel),
      ];
      return {
        type: 'summary',
        summary_type: 'weekly',
        text: `Resumen semanal: ${dueWeek.length} tareas con vencimiento y ${movesWeek.length} movimientos de stock.`,
        items,
        deep_link: crmCfg?.feBase ? joinUrl(crmCfg.feBase, '/tareas') : null,
      };
    }

    if (summaryType === 'overdue') {
      return {
        type: 'summary',
        summary_type: 'overdue',
        text: `Hay ${overdueTasks.length} tareas atrasadas.`,
        items: overdueTasks.slice(0, MAX_ITEMS).map(pickTaskLabel),
        deep_link: crmCfg?.feBase ? joinUrl(crmCfg.feBase, '/tareas') : null,
      };
    }

    if (summaryType === 'upcoming') {
      const items = [
        ...dueWeek.slice(0, MAX_ITEMS).map(pickTaskLabel),
        ...upcomingLeads.slice(0, MAX_ITEMS).map(pickLeadLabel),
      ];
      return {
        type: 'summary',
        summary_type: 'upcoming',
        text: `Vencimientos proximos: ${dueWeek.length} tareas y ${upcomingLeads.length} leads en la semana.`,
        items,
        deep_link: crmCfg?.feBase ? joinUrl(crmCfg.feBase, '/kanban/clientes') : null,
      };
    }

    if (summaryType === 'cold_leads') {
      return {
        type: 'summary',
        summary_type: 'cold_leads',
        text: `Oportunidades frias: ${coldLeads.length} leads en riesgo.`,
        items: coldLeads.slice(0, MAX_ITEMS).map(pickLeadLabel),
        deep_link: crmCfg?.feBase ? joinUrl(crmCfg.feBase, '/kanban/clientes') : null,
      };
    }

    if (summaryType === 'top5_today') {
      const candidates = dueToday.length ? dueToday : tasksList.filter((t) => !t?.completada && t?.vence_en);
      const sorted = candidates
        .slice()
        .sort((a, b) => new Date(a.vence_en || 0).getTime() - new Date(b.vence_en || 0).getTime());
      return {
        type: 'summary',
        summary_type: 'top5_today',
        text: 'Top 5 para hoy.',
        items: sorted.slice(0, MAX_ITEMS).map(pickTaskLabel),
        deep_link: crmCfg?.feBase ? joinUrl(crmCfg.feBase, '/tareas') : null,
      };
    }

    return {
      type: 'message',
      text: 'No entendi el resumen pedido.',
    };
  } catch (err) {
    return { type: 'error', text: 'No pude armar el resumen con los datos actuales.' };
  }
}

module.exports = { getSummary };
