const express    = require('express');
const cors       = require('cors');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');
const path       = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET || 'cambia_esta_clave_secreta_en_produccion';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Usuarios con correo
const usuarios = [
  {
    id: 1,
    correo: 'admin@qraccess.com',
    passwordHash: bcrypt.hashSync('admin123', 10),
    rol: 'admin',
    nombre: 'Administrador'
  },
  {
    id: 2,
    correo: 'empleado1@qraccess.com',
    passwordHash: bcrypt.hashSync('emp123', 10),
    rol: 'empleado',
    nombre: 'Juan García'
  },
  {
    id: 3,
    correo: 'empleado2@qraccess.com',
    passwordHash: bcrypt.hashSync('emp123', 10),
    rol: 'empleado',
    nombre: 'María López'
  }
];

const fichajes = [];

function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch(_) {
    return res.status(401).json({ error: 'Token inválido o caducado' });
  }
}

// POST /api/auth/login — acepta correo
app.post('/api/auth/login', async (req, res) => {
  const { correo, password } = req.body;

  if (!correo || !password) {
    return res.status(400).json({ error: 'Correo y contraseña requeridos' });
  }

  const user = usuarios.find(u => u.correo === correo.toLowerCase().trim());
  if (!user) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  const passwordOk = await bcrypt.compare(password, user.passwordHash);
  if (!passwordOk) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  console.log(`[LOGIN] ${correo} | ${new Date().toISOString()}`);

  const token = jwt.sign(
    { id: user.id, correo: user.correo, rol: user.rol, nombre: user.nombre },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({
    token,
    admin: { correo: user.correo, nombre: user.nombre, rol: user.rol }
  });
});

// POST /api/auth/logout
app.post('/api/auth/logout', authMiddleware, (req, res) => {
  console.log(`[LOGOUT] ${req.user.correo} | ${new Date().toISOString()}`);
  res.json({ ok: true });
});

// POST /api/fichajes
app.post('/api/fichajes', authMiddleware, (req, res) => {
  const { qr } = req.body;
  if (!qr) {
    return res.status(400).json({ error: 'Código QR requerido' });
  }
  const fichajesUsuario = fichajes.filter(f => f.userId === req.user.id);
  const ultimo = fichajesUsuario[fichajesUsuario.length - 1];
  const tipo   = (!ultimo || ultimo.tipo === 'salida') ? 'entrada' : 'salida';
  const fichaje = {
    id: fichajes.length + 1,
    userId: req.user.id,
    correo: req.user.correo,
    nombre: req.user.nombre,
    qr, tipo,
    timestamp: new Date().toISOString()
  };
  fichajes.push(fichaje);
  console.log(`[FICHAJE] ${req.user.correo} – ${tipo} – ${fichaje.timestamp}`);
  res.json({ ok: true, tipo, timestamp: fichaje.timestamp });
});

// GET /api/fichajes
app.get('/api/fichajes', authMiddleware, (req, res) => {
  if (req.user.rol !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  res.json(fichajes);
});

// GET /api/me
app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ id: req.user.id, correo: req.user.correo, nombre: req.user.nombre, rol: req.user.rol });
});

// Catch-all SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🚀 QRAccess corriendo en http://localhost:${PORT}`);
  console.log(`\n📋 Credenciales por defecto:`);
  console.log(`   admin@qraccess.com     / admin123  (rol: admin)`);
  console.log(`   empleado1@qraccess.com / emp123    (rol: empleado)`);
  console.log(`   empleado2@qraccess.com / emp123    (rol: empleado)\n`);
});
