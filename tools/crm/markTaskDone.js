const { resolveModuleConfig, requestJson, joinUrl } = require('../../assistant/remote');

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

module.exports = {
  name: 'crm.mark_task_done',
  module: 'crm',
  action: 'mark_task_done',
  required: ['task_id'],
  async plan({ input, context }) {
    const taskId = toNum(input.task_id);
    if (!taskId) {
      return { status: 'question', question: 'Necesito el id de la tarea.' };
    }

    const cfg = await resolveModuleConfig(context.db, 'crm');
    if (!cfg.apiBase) {
      return { status: 'error', message: 'No tengo configurado el API de CRM.' };
    }

    let task = null;
    try {
      task = await requestJson({
        baseUrl: cfg.apiBase,
        path: `/tareas/${taskId}`,
        method: 'GET',
        context,
      });
    } catch {
      task = null;
    }

    return {
      status: 'ok',
      preview: {
        task_id: taskId,
        titulo: task?.titulo || null,
        cliente: task?.cliente_nombre || null,
      },
      message: `Voy a marcar como hecha la tarea #${taskId}.`,
      steps: ['Verifico la tarea', 'La marco como hecha', 'Actualizo el tablero'],
      deep_link: cfg.feBase ? joinUrl(cfg.feBase, '/tareas') : null,
    };
  },
  async execute({ input, context }) {
    const taskId = toNum(input.task_id);
    const cfg = await resolveModuleConfig(context.db, 'crm');
    if (!cfg.apiBase) {
      return { status: 'error', message: 'No tengo configurado el API de CRM.' };
    }

    const result = await requestJson({
      baseUrl: cfg.apiBase,
      path: `/tareas/${taskId}`,
      method: 'PATCH',
      data: {},
      context,
    });

    return {
      status: 'ok',
      result: { task_id: taskId, estado: result?.estado || 'done' },
      message: `Listo. Tarea #${taskId} marcada como hecha.`,
      deep_link: cfg.feBase ? joinUrl(cfg.feBase, '/tareas') : null,
    };
  },
};
