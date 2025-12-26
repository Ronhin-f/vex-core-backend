const { resolveModuleConfig, requestJson, joinUrl } = require('../../assistant/remote');

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normStage(value) {
  const v = String(value || '').trim();
  return v || null;
}

module.exports = {
  name: 'crm.change_lead_status',
  module: 'crm',
  action: 'change_lead_status',
  required: ['lead_id', 'stage'],
  async plan({ input, context }) {
    const leadId = toNum(input.lead_id);
    const stage = normStage(input.stage);

    if (!leadId) {
      return { status: 'question', question: 'Necesito el id del lead.' };
    }
    if (!stage) {
      return { status: 'question', question: 'A que estado queres pasar el lead?' };
    }

    const cfg = await resolveModuleConfig(context.db, 'crm');
    if (!cfg.apiBase) {
      return { status: 'error', message: 'No tengo configurado el API de CRM.' };
    }

    let lead = null;
    try {
      lead = await requestJson({
        baseUrl: cfg.apiBase,
        path: `/clientes/${leadId}`,
        method: 'GET',
        context,
      });
    } catch {
      lead = null;
    }

    return {
      status: 'ok',
      preview: {
        lead_id: leadId,
        nombre: lead?.nombre || null,
        stage,
      },
      message: `Voy a mover el lead #${leadId} a "${stage}".`,
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
