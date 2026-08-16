// Vercel Serverless Function — expone datos de HK-Interno a NOA
const { createClient } = require('@supabase/supabase-js');
const PROCESOS_BASE = require('./procesos-base.json');

const VALID_RESOURCES = {
  candidatos: 'expData',
  clientes:   'cliExtra',
  vacaciones: 'vacData',
  // 'procesos' es especial: se maneja abajo con fusión base+overrides+custom
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-noa-token');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  // Autenticación
  const token = req.headers['authorization']?.replace(/^Bearer\s+/i, '').trim()
             || req.headers['x-noa-token'];
  if (!token || token !== process.env.NOA_ACCESS_TOKEN) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }

  // Validar resource ANTES de tocar Supabase
  const resource = typeof req.query?.resource === 'string' ? req.query.resource.trim() : '';
  const allResources = [...Object.keys(VALID_RESOURCES), 'procesos'];

  if (!resource) {
    // Sin resource → solo el menú, sin consultas a la base de datos
    res.status(200).json({
      recursos: allResources,
      uso: '/api/noa-data?resource=candidatos',
    });
    return;
  }

  if (!allResources.includes(resource)) {
    res.status(400).json({
      error: `Recurso inválido: "${resource}". Valores permitidos: ${allResources.join(', ')}`,
    });
    return;
  }

  // Solo llega aquí con un resource válido — ahora sí conectamos a Supabase
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    // Procesos: fusión de base histórica + overrides + custom (igual que index.html)
    if (resource === 'procesos') {
      const [{ data: ovrRow, error: ovrErr }, { data: custRow, error: custErr }] = await Promise.all([
        supabase.from('hk_store').select('value').eq('key', 'procOverrides').single(),
        supabase.from('hk_store').select('value').eq('key', 'procCustom').single(),
      ]);
      if ((ovrErr && ovrErr.code !== 'PGRST116') || (custErr && custErr.code !== 'PGRST116')) {
        res.status(500).json({ error: (ovrErr || custErr).message });
        return;
      }
      const overrides = ovrRow?.value || {};
      const custom    = Array.isArray(custRow?.value) ? custRow.value : [];
      const base      = PROCESOS_BASE.map(p => ({ ...p, ...overrides[p.id] }));
      const cust      = custom.map(p => ({ ...p, ...overrides[p.id] }));
      res.status(200).json({ resource, data: [...base, ...cust] });
      return;
    }

    // Resto de recursos: una sola key específica, siempre filtrada
    const storeKey = VALID_RESOURCES[resource];
    const { data, error } = await supabase
      .from('hk_store')
      .select('value')
      .eq('key', storeKey)
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
