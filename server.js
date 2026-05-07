// HK Human Capital — Servidor local con proxy a IA (Gemini / Groq)
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 5000;
const DIR = __dirname;

// Clave por defecto (Google AI Studio). Se sobreescribe si el frontend envía x-api-key.
const DEFAULT_KEY = 'AIzaSyBnN_SgGKpfXPROzroeQmSLVaRG4TRKOis';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
};

function sendJSON(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

// ── PROXY GEMINI (Google AI Studio) ──────────────────────────────────────────
function proxyGemini(apiKey, body, res) {
  const maxTokens = body.max_tokens || 8192;
  const messages  = body.messages  || [];

  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
  }));

  const googleBody = JSON.stringify({
    contents,
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 }
  });

  // Try models in order
  const models = ['gemini-2.5-flash-lite-preview-06-17', 'gemini-2.5-flash', 'gemini-2.0-flash'];
  let attempt = 0;

  function tryModel() {
    const model = models[attempt];
    const opts = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(googleBody) }
    };

    const req = https.request(opts, r => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try {
          const g = JSON.parse(data);
          // Quota error → try next model
          if (g.error && (g.error.code === 429 || (g.error.message||'').includes('quota')) && attempt < models.length - 1) {
            attempt++;
            return tryModel();
          }
          if (g.error) {
            const msg = g.error.message || 'Google AI Studio error';
            const isQuota = msg.includes('quota') || g.error.code === 429;
            return sendJSON(res, 429, {
              error: {
                message: isQuota
                  ? '⚠️ Cuota de Google AI Studio agotada. Obtén una clave gratuita de Groq en console.groq.com (más confiable) e ingrésala en API Key IA.'
                  : msg,
                type: 'quota_exceeded'
              }
            });
          }
          const text = g?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          sendJSON(res, 200, { content: [{ type: 'text', text }] });
        } catch(e) {
          sendJSON(res, 502, { error: { message: 'Error procesando respuesta: ' + e.message } });
        }
      });
    });
    req.on('error', e => sendJSON(res, 502, { error: { message: e.message } }));
    req.write(googleBody);
    req.end();
  }

  tryModel();
}

// ── PROXY GROQ (OpenAI-compatible, gratis) ────────────────────────────────────
function proxyGroq(apiKey, body, res) {
  const maxTokens = Math.min(body.max_tokens || 8192, 8192);
  const messages  = body.messages || [];

  const groqBody = JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    max_tokens: maxTokens,
    temperature: 0.7
  });

  const opts = {
    hostname: 'api.groq.com',
    path: '/openai/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Content-Length': Buffer.byteLength(groqBody)
    }
  };

  const req = https.request(opts, r => {
    let data = '';
    r.on('data', c => data += c);
    r.on('end', () => {
      try {
        const g = JSON.parse(data);
        if (g.error) return sendJSON(res, 400, { error: { message: g.error.message } });
        const text = g?.choices?.[0]?.message?.content || '';
        sendJSON(res, 200, { content: [{ type: 'text', text }] });
      } catch(e) {
        sendJSON(res, 502, { error: { message: 'Error procesando respuesta Groq: ' + e.message } });
      }
    });
  });
  req.on('error', e => sendJSON(res, 502, { error: { message: e.message } }));
  req.write(groqBody);
  req.end();
}

// ─────────────────────────────────────────────────────────────────────────────
http.createServer((req, res) => {

  if (req.url === '/api/claude' && req.method === 'POST') {
    const apiKey = (req.headers['x-api-key'] || DEFAULT_KEY).trim();
    let bodyStr = '';
    req.on('data', chunk => bodyStr += chunk);
    req.on('end', () => {
      let body;
      try { body = JSON.parse(bodyStr); } catch(e) {
        return sendJSON(res, 400, { error: { message: 'JSON inválido' } });
      }
      if (apiKey.startsWith('gsk_')) {
        proxyGroq(apiKey, body, res);
      } else {
        proxyGemini(apiKey, body, res);
      }
    });
    return;
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type, x-api-key'
    });
    res.end();
    return;
  }

  let filePath = req.url.split('?')[0];
  if (filePath === '/') filePath = '/index.html';
  const full = path.join(DIR, filePath);
  if (!full.startsWith(DIR)) { res.writeHead(403); res.end(); return; }

  fs.readFile(full, (err, content) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(content);
  });

}).listen(PORT, () => {
  console.log(`✓ HK Portal → http://localhost:${PORT}  [Gemini 1.5-flash + Groq fallback]`);
});
