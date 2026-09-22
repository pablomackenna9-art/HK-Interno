// Vercel Cron — mantiene Supabase activo con una query diaria
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  // Solo permitir llamadas del cron de Vercel (o GET directo para testing)
  const authHeader = req.headers['authorization'];
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Faltan variables de entorno Supabase' });
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Query mínima — solo cuenta filas, no trae datos
    const { count, error } = await supabase
      .from('hk_store')
      .select('*', { count: 'exact', head: true });

    if (error) throw error;

    const now = new Date().toISOString();
    console.log(`[keep-alive] ${now} — hk_store tiene ${count} filas`);

    return res.status(200).json({
      ok: true,
      timestamp: now,
      rows: count
    });
  } catch (e) {
    console.error('[keep-alive] Error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
