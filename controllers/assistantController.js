const assistantEngine = require('../assistant/engine');

function buildRequestId(req) {
  if (req?.id) return req.id;
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 1000000);
  return `assist-${ts}-${rand}`;
}

exports.chat = async (req, res) => {
  try {
    const { message, confirm_token, currentModule, currentRoute, entityContext, userLocale } = req.body || {};
    const user = req.user || req.usuario;

    if (!user || !user.organizacion_id) {
      return res.status(401).json({ type: 'error', text: 'No autorizado' });
    }

    const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
    const token =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : null;

    const requestId = buildRequestId(req);

    const response = await assistantEngine.handleChat({
      message,
      confirm_token,
      context: {
        user,
        orgId: user.organizacion_id,
        currentModule: currentModule || 'core',
        currentRoute: currentRoute || null,
        entityContext: entityContext || {},
        userLocale: userLocale || 'es-AR',
        db: req.db,
        requestId,
        authToken: token,
      },
    });

    const debugEnabled =
      String(process.env.ASSISTANT_DEBUG || '') === '1' ||
      String(req.headers['x-assistant-debug'] || '') === '1';

    if (!debugEnabled) {
      return res.json(response);
    }

    return res.json({
      ...response,
      debug: {
        request_id: requestId,
        module: currentModule || 'core',
        route: currentRoute || null,
        response_type: response?.type || null,
      },
    });
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[assistantController/chat]', err);
    }
    return res.status(500).json({ type: 'error', text: 'Error interno del asistente' });
  }
};
