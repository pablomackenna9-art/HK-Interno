// Vercel Serverless Function — expone datos de HK-Interno a NOA
const { createClient } = require('@supabase/supabase-js');

// Snapshot histórico de procesos, el mismo array PROCESOS_BASE que vive
// hardcodeado en index.html — nunca estuvo en la base de datos, así que
// sin este archivo el endpoint no puede ver esos procesos (solo veía los
// agregados manuales en procCustom). Los procesos nuevos siguen entrando
// por procCustom como siempre; este archivo no necesita tocarse salvo
// que se quiera refrescar el snapshot histórico.
const PROCESOS_BASE = require('./procesos-base.json');

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

    // "procesos" es un caso especial: la lista completa es
    // PROCESOS_BASE (snapshot histórico) + procOverrides (ediciones sobre
    // esos registros) + procCustom (procesos agregados después) — la
    // misma fusión que hace getProcData() en el propio index.html. Los
    // demás recursos siguen siendo una lectura directa de una sola key.
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
      const custom = Array.isArray(custRow?.value) ? custRow.value : [];

      const base = PROCESOS_BASE.map((p) => Object.assign({}, p, overrides[p.id] || {}));
      const cust = custom.map((p) => Object.assign({}, p, overrides[p.id] || {}));
      res.status(200).json({ resource, data: [...base, ...cust] });
      return;
    }

    // Leer desde hk_store
    const keyMap = {
      candidatos: 'expData',
      clientes:   'cliExtra',
      vacaciones: 'vacData',
    };

    const storeKey = keyMap[resource];
    if (!storeKey) {
      res.status(400).json({ error: `Recurso desconocido: ${resource}. Usa: candidatos, clientes, procesos, vacaciones` });
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
