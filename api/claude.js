// Vercel Serverless Function — proxy a Gemini / Groq
const https = require('https');

const DEFAULT_KEY = 'AIzaSyBnN_SgGKpfXPROzroeQmSLVaRG4TRKOis';

function sendJSON(res, status, obj) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  res.status(status).json(obj);
}

function httpsPost(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, r => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function proxyGemini(apiKey, messages, maxTokens, res) {
  const models = ['gemini-2.5-flash-lite-preview-06-17', 'gemini-2.5-flash', 'gemini-2.0-flash'];
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
  }));
  const googleBody = JSON.stringify({ contents, generationConfig: { maxOutputTokens: maxTokens, temperature: 0.5 } });

  for (const model of models) {
    try {
      const opts = {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(googleBody) }
      };
      const g = await httpsPost(opts, googleBody);
      if (g.error) {
        if (g.error.code === 429 || g.error.code === 404 || g.error.code === 503) continue;
        return sendJSON(res, 400, { error: { message: g.error.message } });
      }
      const text = g?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return sendJSON(res, 200, { content: [{ type: 'text', text }] });
    } catch(e) { continue; }
  }
  sendJSON(res, 429, { error: { message: 'Todos los modelos de Gemini fallaron o cuota agotada.' } });
}

async function proxyGroq(apiKey, messages, maxTokens, res) {
  const groqBody = JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    max_tokens: Math.min(maxTokens, 8192), temperature: 0.5
  });
  try {
    const opts = {
      hostname: 'api.groq.com', path: '/openai/v1/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Content-Length': Buffer.byteLength(groqBody) }
    };
    const g = await httpsPost(opts, groqBody);
    if (g.error) return sendJSON(res, 400, { error: { message: g.error.message } });
    const text = g?.choices?.[0]?.message?.content || '';
    sendJSON(res, 200, { content: [{ type: 'text', text }] });
  } catch(e) { sendJSON(res, 502, { error: { message: e.message } }); }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).end(); return; }

  const apiKey   = (req.headers['x-api-key'] || DEFAULT_KEY).trim();
  const body     = req.body || {};
  const messages = body.messages || [];
  const maxTok   = body.max_tokens || 8192;

  if (apiKey.startsWith('gsk_')) {
    await proxyGroq(apiKey, messages, maxTok, res);
  } else {
    await proxyGemini(apiKey, messages, maxTok, res);
  }
};
