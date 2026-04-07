// app.js — Punto de entrada del backend Node.js (QRAccess)
//
// Instalación:  npm install
// Arranque:     node app.js   (o  npm start)
// Tests:        npm test

'use strict';

const express = require('express');
const cors    = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// ── Rutas ─────────────────────────────────────────────────────────────────────
/* eslint-disable-next-line */
const authRoutes     = require('./auth(1)');
const employeeRoutes = require('./employees');
const checkinRoutes  = require('./checkins');
const terminalRoutes = require('./terminals');

app.use('/api/auth',      authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/checkins',  checkinRoutes);
app.use('/api/terminals', terminalRoutes);

// ── Arrancar servidor solo cuando se ejecuta directamente ─────────────────────
if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`\n🚀 Backend corriendo en http://localhost:${PORT}`);
    console.log(`   POST /api/auth/login   — obtener JWT`);
    console.log(`   GET  /api/employees    — listar empleados (JWT requerido)`);
    console.log(`   POST /api/checkins     — registrar fichaje (X-API-Key requerida)\n`);
  });
}

module.exports = app;
