const { resolveModuleConfig, requestJson, joinUrl } = require('../../assistant/remote');

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

module.exports = {
  name: 'stock.register_movement',
  module: 'stock',
  action: 'register_movement',
  required: ['cantidad', 'almacen_origen', 'almacen_destino'],
  async plan({ input, context }) {
    const productoId = toNum(input.producto_id);
    const productoNombre = input.producto_nombre ? String(input.producto_nombre).trim() : null;
    const cantidad = Number(input.cantidad);
    const almacenOrigen = toNum(input.almacen_origen);
    const almacenDestino = toNum(input.almacen_destino);

    if (!productoId && !productoNombre) {
      return { status: 'question', question: 'Necesito el id o el nombre del producto.' };
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

    let finalProductId = productoId;
    let producto = null;

    if (!finalProductId && productoNombre) {
      const list = await requestJson({
        baseUrl: cfg.apiBase,
        path: '/productos',
        method: 'GET',
        params: { q: productoNombre },
        context,
      });
      const productos = Array.isArray(list) ? list : [];
      const filtered = almacenOrigen
        ? productos.filter((p) => Number(p?.almacen_id) === Number(almacenOrigen))
        : productos;

      if (!filtered.length) {
        return { status: 'error', message: 'No encontre un producto con ese nombre en el almacen de origen.' };
      }
      const exact = filtered.filter(
        (p) => String(p?.nombre || '').trim().toLowerCase() === productoNombre.toLowerCase()
      );
      const pick = exact.length === 1 ? exact[0] : filtered.length === 1 ? filtered[0] : null;
      if (!pick) {
        const listStr = filtered.slice(0, 5).map((p) => `#${p.id} - ${p.nombre}`).join(', ');
        return {
          status: 'question',
          question: `Hay varios productos. Decime el id exacto. Ej: ${listStr}`,
        };
      }
      finalProductId = toNum(pick.id);
      producto = pick;
    }

    return {
      status: 'ok',
      inputs: {
        producto_id: finalProductId,
        cantidad,
        almacen_origen: almacenOrigen,
        almacen_destino: almacenDestino,
      },
      preview: {
        producto_id: finalProductId,
        producto_nombre: producto?.nombre || productoNombre || null,
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
