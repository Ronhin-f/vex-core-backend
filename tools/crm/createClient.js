const { resolveModuleConfig, requestJson, joinUrl } = require('../../assistant/remote');

function normText(v) {
  const s = String(v || '').trim();
  return s ? s : null;
}

module.exports = {
  name: 'crm.create_client',
  module: 'crm',
  action: 'create_client',
  required: ['nombre'],
  async plan({ input, context }) {
    const nombre = normText(input.nombre);
    const contactoNombre = normText(input.contacto_nombre);
    const email = normText(input.email);
    const telefono = normText(input.telefono);

    if (!nombre) {
      return { status: 'question', question: 'Como se llama el cliente?' };
    }

    const cfg = await resolveModuleConfig(context.db, 'crm');
    if (!cfg.apiBase) {
      return { status: 'error', message: 'No tengo configurado el API de CRM.' };
    }

    return {
      status: 'ok',
      preview: {
        nombre,
        contacto_nombre: contactoNombre || null,
        email: email || null,
        telefono: telefono || null,
      },
      message: `Voy a crear el cliente "${nombre}".`,
      steps: ['Creo el cliente', 'Asocio contacto principal si aplica'],
      deep_link: cfg.feBase ? joinUrl(cfg.feBase, '/clientes') : null,
    };
  },
  async execute({ input, context }) {
    const nombre = normText(input.nombre);
    const contactoNombre = normText(input.contacto_nombre);
    const email = normText(input.email);
    const telefono = normText(input.telefono);

    const cfg = await resolveModuleConfig(context.db, 'crm');
    if (!cfg.apiBase) {
      return { status: 'error', message: 'No tengo configurado el API de CRM.' };
    }

    const payload = {
      nombre,
      contacto_nombre: contactoNombre,
      email,
      telefono,
      status: 'active',
    };

    try {
      const result = await requestJson({
        baseUrl: cfg.apiBase,
        path: '/clientes',
        method: 'POST',
        data: payload,
        context,
      });

      return {
        status: 'ok',
        result: { cliente_id: result?.id || null, nombre: result?.nombre || nombre },
        message: `Listo. Cliente "${nombre}" creado.`,
        deep_link: cfg.feBase ? joinUrl(cfg.feBase, '/clientes') : null,
      };
    } catch (err) {
      const status = err?.status || null;
      const data = err?.data || null;
      const base = status ? `No pude crear el cliente. (HTTP ${status})` : 'No pude crear el cliente.';
      const debugEnabled = String(process.env.ASSISTANT_DEBUG || '') === '1';
      return {
        status: 'error',
        message: base,
        debug: debugEnabled ? { status, data } : undefined,
      };
    }
  },
};
