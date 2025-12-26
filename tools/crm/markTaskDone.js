const { resolveModuleConfig, requestJson, joinUrl } = require('../../assistant/remote');

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchTasksByTitle(context, query) {
  const cfg = await resolveModuleConfig(context.db, 'crm');
  if (!cfg.apiBase) return [];
  const data = await requestJson({
    baseUrl: cfg.apiBase,
    path: '/tareas',
    method: 'GET',
    params: { q: query, limit: 20, offset: 0 },
    context,
  });
  return Array.isArray(data) ? data : [];
}

function normalizeTitle(t) {
  return String(t || '').trim().toLowerCase();
}

module.exports = {
  name: 'crm.mark_task_done',
  module: 'crm',
  action: 'mark_task_done',
  required: [],
  async plan({ input, context }) {
    const taskId = toNum(input.task_id);
    const taskTitle = input.task_title ? String(input.task_title).trim() : null;

    if (!taskId && !taskTitle) {
      return { status: 'question', question: 'Decime el id o el titulo exacto de la tarea.' };
    }

    const cfg = await resolveModuleConfig(context.db, 'crm');
    if (!cfg.apiBase) {
      return { status: 'error', message: 'No tengo configurado el API de CRM.' };
    }

    let finalTaskId = taskId;
    let task = null;

    if (!finalTaskId && taskTitle) {
      const tasks = await fetchTasksByTitle(context, taskTitle);
      if (!tasks.length) {
        return { status: 'error', message: 'No encontre una tarea con ese titulo.' };
      }
      const exact = tasks.filter((t) => normalizeTitle(t?.titulo) === normalizeTitle(taskTitle));
      const pick = exact.length === 1 ? exact[0] : tasks.length === 1 ? tasks[0] : null;
      if (!pick) {
        const list = tasks.slice(0, 5).map((t) => `#${t.id} - ${t.titulo}`).join(', ');
        return {
          status: 'question',
          question: `Tengo varias tareas. Decime el id exacto. Ej: ${list}`,
        };
      }
      finalTaskId = toNum(pick.id);
      task = pick;
    } else {
      try {
        task = await requestJson({
          baseUrl: cfg.apiBase,
          path: `/tareas/${finalTaskId}`,
          method: 'GET',
          context,
        });
      } catch {
        task = null;
      }
    }

    return {
      status: 'ok',
      inputs: { task_id: finalTaskId },
      preview: {
        task_id: finalTaskId,
        titulo: task?.titulo || null,
        cliente: task?.cliente_nombre || null,
      },
      message: `Voy a marcar como hecha la tarea #${finalTaskId}.`,
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
