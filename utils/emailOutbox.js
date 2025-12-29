async function ensureEmailOutboxTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS email_outbox (
      id SERIAL PRIMARY KEY,
      organizacion_id INTEGER NOT NULL,
      to_email TEXT NOT NULL,
      template TEXT NOT NULL,
      payload JSONB,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      sent_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_email_outbox_status ON email_outbox (status);
    CREATE INDEX IF NOT EXISTS idx_email_outbox_org ON email_outbox (organizacion_id);
    CREATE INDEX IF NOT EXISTS idx_email_outbox_to_email ON email_outbox (to_email);
  `);
}

async function enqueueEmailOutbox(db, data) {
  if (!data?.organizacion_id || !data?.to_email || !data?.template) {
    return;
  }
  await ensureEmailOutboxTable(db);
  await db.query(
    `INSERT INTO email_outbox (organizacion_id, to_email, template, payload)
     VALUES ($1, $2, $3, $4)`,
    [data.organizacion_id, data.to_email, data.template, data.payload || null]
  );
}

module.exports = { ensureEmailOutboxTable, enqueueEmailOutbox };
