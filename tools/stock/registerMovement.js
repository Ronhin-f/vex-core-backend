const { resolveModuleConfig, requestJson, joinUrl } = require('../../assistant/remote');

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

module.exports = {
  name: 'stock.register_movement',
  module: 'stock',
  action: 'register_movement',
  required: ['producto_id', 'cantidad', 'almacen_origen', 'almacen_destino'],
  async plan({ input, context }) {
    const productoId = toNum(input.producto_id);
    const cantidad = Number(input.cantidad);
    const almacenOrigen = toNum(input.almacen_origen);
    const almacenDestino = toNum(input.almacen_destino);

    if (!productoId) {
      return { status: 'question', question: 'Necesito el id del producto.' };
    }
    if (!cantidad || cantidad <= 0) {
      return { status: 'question', question: 'Cuanta cantidad?' };
    }
    if (!almacenOrigen) {
      return { status: 'question', question: 'Necesito el id del almacen de origen.' };
    }
    if (!almacenDestino) {
      return { status: 'question', question: 'Necesito el id del almacen de destino.' };
    }
    if (almacenOrigen === almacenDestino) {
      return { status: 'error', message: 'Origen y destino no pueden ser iguales.' };
    }

    const cfg = await resolveModuleConfig(context.db, 'stock');
    if (!cfg.apiBase) {
      return { status: 'error', message: 'No tengo configurado el API de Stock.' };
    }

    return {
      status: 'ok',
      preview: {
        producto_id: productoId,
        cantidad,
        almacen_origen: almacenOrigen,
        almacen_destino: almacenDestino,
      },
      message: `Voy a registrar un movimiento de ${cantidad} unidades.`,
      steps: ['Valido stock en origen', 'Registro el traslado', 'Actualizo inventario'],
      deep_link: cfg.feBase ? joinUrl(cfg.feBase, '/movimientos') : null,
    };
  },
  async execute({ input, context }) {
    const productoId = toNum(input.producto_id);
    const cantidad = Number(input.cantidad);
    const almacenOrigen = toNum(input.almacen_origen);
    const almacenDestino = toNum(input.almacen_destino);

    const cfg = await resolveModuleConfig(context.db, 'stock');
    if (!cfg.apiBase) {
      return { status: 'error', message: 'No tengo configurado el API de Stock.' };
    }

    await requestJson({
      baseUrl: cfg.apiBase,
      path: '/traslados',
      method: 'POST',
      data: {
        producto_id: productoId,
        cantidad,
        almacen_origen: almacenOrigen,
        almacen_destino: almacenDestino,
      },
      context,
    });

    return {
      status: 'ok',
      result: {
        producto_id: productoId,
        cantidad,
        almacen_origen: almacenOrigen,
        almacen_destino: almacenDestino,
      },
      message: 'Listo. Movimiento registrado.',
      deep_link: cfg.feBase ? joinUrl(cfg.feBase, '/movimientos') : null,
    };
  },
};
