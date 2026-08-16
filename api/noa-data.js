// Vercel Serverless Function — expone datos de HK-Interno a NOA
const { createClient } = require('@supabase/supabase-js');

const VALID_RESOURCES = {
  candidatos: 'expData',
  clientes:   'cliExtra',
  procesos:   'procCustom',
  vacaciones: 'vacData',
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-noa-token');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  // Autenticación — rechaza si falta o no coincide
  const token = req.headers['authorization']?.replace('Bearer ', '').trim()
             || req.headers['x-noa-token'];
  if (!token || token !== process.env.NOA_ACCESS_TOKEN) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }

  // Validar resource ANTES de tocar Supabase
  const resource = typeof req.query?.resource === 'string' ? req.query.resource.trim() : '';

  if (!resource) {
    // Sin resource → solo el menú, sin consultas
    res.status(200).json({
      recursos: Object.keys(VALID_RESOURCES),
      uso: '/api/noa-data?resource=candidatos',
    });
    return;
  }

  const storeKey = VALID_RESOURCES[resource];
  if (!storeKey) {
    res.status(400).json({
      error: `Recurso inválido: "${resource}". Valores permitidos: ${Object.keys(VALID_RESOURCES).join(', ')}`,
    });
    return;
  }

  // Solo llega aquí con un resource válido y una key específica
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data, error } = await supabase
      .from('hk_store')
      .select('value')
      .eq('key', storeKey)   // siempre filtrado por key exacta
      .single();

    if (error && error.code !== 'PGRST116') {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json({ resource, data: data?.value ?? null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
