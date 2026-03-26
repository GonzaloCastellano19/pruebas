// app.js — punto de entrada del servidor Express
const express = require('express');
const helmet  = require('helmet');

const authRoutes      = require('./routes/auth');
const employeeRoutes  = require('./routes/employees');
const terminalRoutes  = require('./routes/terminals');
const checkinRoutes   = require('./routes/checkins');

const app = express();

// ── Middlewares globales ──────────────────────────────────────────────────────
app.use(helmet());                  // Cabeceras de seguridad HTTP
app.use(express.json());            // Parsear body como JSON

// ── CORS simple para desarrollo ───────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Ruta de comprobación (smoke test) ─────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    data: {
      message: 'API Lector QR para Fichar — funcionando',
      version: '1.0.0',
      endpoints: {
        auth:      'POST /api/auth/login',
        employees: 'GET|POST /api/employees',
        terminals: 'GET|POST /api/terminals',
        checkins:  'GET|POST /api/checkins'
      }
    }
  });
});

// ── Rutas de la API ───────────────────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/terminals', terminalRoutes);
app.use('/api/checkins',  checkinRoutes);

// ── Manejo de rutas no encontradas ────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Ruta ${req.method} ${req.path} no encontrada` });
});

// ── Manejo global de errores ──────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Error no controlado:', err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ── Arrancar servidor ─────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n Servidor arrancado en http://localhost:${PORT}`);
    console.log(` Admin de prueba → usuario: admin  /  contraseña: admin123`);
    console.log(` Terminal de prueba → X-API-Key: terminal_key_123456\n`);
  });
}

module.exports = app; // exportado para los tests