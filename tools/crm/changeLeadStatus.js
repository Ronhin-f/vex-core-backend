const { resolveModuleConfig, requestJson, joinUrl } = require('../../assistant/remote');

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normStage(value) {
  const v = String(value || '').trim();
  return v || null;
}

async function fetchLeadsByQuery(context, query) {
  const cfg = await resolveModuleConfig(context.db, 'crm');
  if (!cfg.apiBase) return [];
  const data = await requestJson({
    baseUrl: cfg.apiBase,
    path: '/clientes',
    method: 'GET',
    params: { q: query, status: 'all' },
    context,
  });
  return Array.isArray(data) ? data : [];
}

function normalizeName(v) {
  return String(v || '').trim().toLowerCase();
}

module.exports = {
  name: 'crm.change_lead_status',
  module: 'crm',
  action: 'change_lead_status',
  required: ['stage'],
  async plan({ input, context }) {
    const leadId = toNum(input.lead_id);
    const stage = normStage(input.stage);
    const leadName = input.lead_name ? String(input.lead_name).trim() : null;

    if (!stage) {
      return { status: 'question', question: 'A que estado queres pasar el lead?' };
    }

    const cfg = await resolveModuleConfig(context.db, 'crm');
    if (!cfg.apiBase) {
      return { status: 'error', message: 'No tengo configurado el API de CRM.' };
    }

    let finalLeadId = leadId;
    let lead = null;

    if (!finalLeadId && leadName) {
      const leads = await fetchLeadsByQuery(context, leadName);
      if (!leads.length) {
        return { status: 'error', message: 'No encontre un lead con ese nombre.' };
      }
      const exact = leads.filter((l) => normalizeName(l?.nombre) === normalizeName(leadName));
      const pick = exact.length === 1 ? exact[0] : leads.length === 1 ? leads[0] : null;
      if (!pick) {
        const list = leads.slice(0, 5).map((l) => `#${l.id} - ${l.nombre}`).join(', ');
        return {
          status: 'question',
          question: `Tengo varios leads. Decime el id exacto. Ej: ${list}`,
        };
      }
      finalLeadId = toNum(pick.id);
      lead = pick;
    } else if (finalLeadId) {
      try {
        lead = await requestJson({
          baseUrl: cfg.apiBase,
          path: `/clientes/${finalLeadId}`,
          method: 'GET',
          context,
        });
      } catch {
        lead = null;
      }
    } else {
      return { status: 'question', question: 'Necesito el id o nombre del lead.' };
    }

    return {
      status: 'ok',
      inputs: { lead_id: finalLeadId, stage },
      preview: {
        lead_id: finalLeadId,
        nombre: lead?.nombre || null,
        stage,
      },
      message: `Voy a mover el lead #${finalLeadId} a "${stage}".`,
      steps: ['Valido el lead', 'Cambio el estado en kanban', 'Actualizo el pipeline'],
      deep_link: cfg.feBase ? joinUrl(cfg.feBase, '/kanban/clientes') : null,
    };
  },
  async execute({ input, context }) {
    const leadId = toNum(input.lead_id);
    const stage = normStage(input.stage);
    const cfg = await resolveModuleConfig(context.db, 'crm');
    if (!cfg.apiBase) {
      return { status: 'error', message: 'No tengo configurado el API de CRM.' };
    }

    const result = await requestJson({
      baseUrl: cfg.apiBase,
      path: `/kanban/clientes/${leadId}/move`,
      method: 'PATCH',
      data: { stage },
      context,
    });

    return {
      status: 'ok',
      result: {
        lead_id: leadId,
        stage: result?.stage || stage,
      },
      message: `Listo. Lead #${leadId} movido a "${stage}".`,
      deep_link: cfg.feBase ? joinUrl(cfg.feBase, '/kanban/clientes') : null,
    };
  },
};
