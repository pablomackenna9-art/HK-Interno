// Vercel Serverless Function — expone datos de HK-Interno a NOA
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-noa-token');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  // Autenticación
  const token = req.headers['authorization']?.replace('Bearer ', '') || req.headers['x-noa-token'];
  if (!token || token !== process.env.NOA_ACCESS_TOKEN) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }

  // Supabase
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const { resource } = req.query;

    if (!resource) {
      // Devuelve resumen de recursos disponibles
      res.status(200).json({
        recursos: ['candidatos', 'clientes', 'procesos', 'vacaciones'],
        uso: '/api/noa-data?resource=candidatos'
      });
      return;
    }

    // Leer desde hk_store
    const keyMap = {
      candidatos: 'expData',
      clientes:   'cliExtra',
      procesos:   'procCustom',
      vacaciones: 'vacData',
    };

    const storeKey = keyMap[resource];
    if (!storeKey) {
      res.status(400).json({ error: `Recurso desconocido: ${resource}. Usa: ${Object.keys(keyMap).join(', ')}` });
      return;
    }

    const { data, error } = await supabase
      .from('hk_store')
      .select('value')
      .eq('key', storeKey)
      .single();

    if (error && error.code !== 'PGRST116') {
      res.status(500).json({ error: error.message });
      return;
    }

    const value = data?.value ?? null;
    res.status(200).json({ resource, data: value });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
