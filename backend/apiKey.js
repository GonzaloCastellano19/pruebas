// middleware/apiKey.js — verifica la X-API-Key del kiosco/terminal
const db = require('./db');

module.exports = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'X-API-Key requerida' });
  }

  const terminal = db.getTerminalByApiKey(apiKey);

  if (!terminal) {
    return res.status(403).json({ error: 'API Key no válida' });
  }

  // Adjunta el terminal al request para usarlo en la ruta
  req.terminal = terminal;
  next();
};
