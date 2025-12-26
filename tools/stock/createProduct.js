const { resolveModuleConfig, requestJson, joinUrl } = require('../../assistant/remote');

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normText(v) {
  const s = String(v || '').trim();
  return s ? s : null;
}

async function findAlmacenById(context, almacenId) {
  const cfg = await resolveModuleConfig(context.db, 'stock');
  if (!cfg.apiBase) return null;
  const list = await requestJson({
    baseUrl: cfg.apiBase,
    path: '/almacenes',
    method: 'GET',
    context,
  });
  if (!Array.isArray(list)) return null;
  return list.find((a) => Number(a?.id) === Number(almacenId)) || null;
}

module.exports = {
  name: 'stock.create_product',
  module: 'stock',
  action: 'create_product',
  required: ['nombre', 'almacen_id'],
  async plan({ input, context }) {
    const nombre = normText(input.nombre);
    const almacenId = toNum(input.almacen_id);

    if (!nombre) {
      return { status: 'question', question: 'Como se llama el producto?' };
    }
    if (!almacenId) {
      return { status: 'question', question: 'Necesito el id del almacen para crear el producto.' };
    }

    const cfg = await resolveModuleConfig(context.db, 'stock');
    if (!cfg.apiBase) {
      return { status: 'error', message: 'No tengo configurado el API de Stock.' };
    }

    let almacen = null;
    try {
      almacen = await findAlmacenById(context, almacenId);
    } catch {
      almacen = null;
    }
    if (!almacen) {
      return { status: 'error', message: 'No encontre ese almacen en Stock.' };
    }

    return {
      status: 'ok',
      preview: {
        nombre,
        almacen_id: almacenId,
        almacen: almacen?.nombre || null,
      },
      message: `Voy a crear el producto "${nombre}" en el almacen ${almacen?.nombre || almacenId}.`,
      steps: ['Valido el almacen', 'Creo el producto', 'Queda disponible en inventario'],
      deep_link: cfg.feBase ? joinUrl(cfg.feBase, '/productos') : null,
    };
  },
  async execute({ input, context }) {
    const nombre = normText(input.nombre);
    const almacenId = toNum(input.almacen_id);

    const cfg = await resolveModuleConfig(context.db, 'stock');
    if (!cfg.apiBase) {
      return { status: 'error', message: 'No tengo configurado el API de Stock.' };
    }

    const result = await requestJson({
      baseUrl: cfg.apiBase,
      path: '/productos',
      method: 'POST',
      data: { nombre, almacen_id: almacenId },
      context,
    });

    return {
      status: 'ok',
      result: {
        producto_id: result?.id || null,
        nombre: result?.nombre || nombre,
        almacen_id: result?.almacen_id || almacenId,
      },
      message: `Listo. Producto "${nombre}" creado.`,
      deep_link: cfg.feBase ? joinUrl(cfg.feBase, '/productos') : null,
    };
  },
};
