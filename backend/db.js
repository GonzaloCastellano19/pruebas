// db.js — almacén en memoria (sustituye a SQLite durante el desarrollo)
// Cuando conectes SQLite, solo tendrás que cambiar este archivo.

const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

// ── Datos de ejemplo precargados ─────────────────────────────────────────────
const db = {
  employees: [
    {
      id: 1,
      name: 'Ana García',
      qr_token: 'emp_' + 'a1b2c3d4e5f6a1b2c3d4e5f6',
      status: 'active',
      created_at: new Date().toISOString()
    },
    {
      id: 2,
      name: 'Carlos López',
      qr_token: 'emp_' + 'b2c3d4e5f6a1b2c3d4e5f6a1',
      status: 'active',
      created_at: new Date().toISOString()
    }
  ],

  terminals: [
    {
      id: 1,
      name: 'Kiosco Entrada Principal',
      location: 'Planta Baja',
      api_key: 'terminal_key_123456',
      created_at: new Date().toISOString()
    }
  ],

  checkins: [],

  // Usuario admin de prueba (contraseña: admin123)
  admins: [
    { id: 1, username: 'admin', passwordHash: bcrypt.hashSync('admin123', 10) }
  ],

  // Contadores para IDs autoincrementales
  _counters: { employees: 2, terminals: 1, checkins: 0 }
};

// ── Helpers que imitan las queries de SQLite ──────────────────────────────────

// EMPLOYEES
db.getEmployees = (page = 1, pageSize = 20) => {
  const start = (page - 1) * pageSize;
  return db.employees.slice(start, start + pageSize);
};

db.getEmployeeById = (id) =>
  db.employees.find(e => e.id === parseInt(id)) || null;

db.getEmployeeByToken = (qr_token) =>
  db.employees.find(e => e.qr_token === qr_token) || null;

db.createEmployee = (name) => {
  db._counters.employees++;
  const employee = {
    id: db._counters.employees,
    name,
    qr_token: 'emp_' + uuidv4().replace(/-/g, ''),
    status: 'active',
    created_at: new Date().toISOString()
  };
  db.employees.push(employee);
  return employee;
};

db.updateEmployee = (id, data) => {
  const idx = db.employees.findIndex(e => e.id === parseInt(id));
  if (idx === -1) return null;
  db.employees[idx] = { ...db.employees[idx], ...data };
  return db.employees[idx];
};

db.deleteEmployee = (id) => {
  const idx = db.employees.findIndex(e => e.id === parseInt(id));
  if (idx === -1) return false;
  db.employees.splice(idx, 1);
  return true;
};

// TERMINALS
db.getTerminals = () => db.terminals;

db.getTerminalByApiKey = (api_key) =>
  db.terminals.find(t => t.api_key === api_key) || null;

db.createTerminal = (name, location) => {
  db._counters.terminals++;
  const terminal = {
    id: db._counters.terminals,
    name,
    location: location || '',
    api_key: 'terminal_key_' + uuidv4().replace(/-/g, '').slice(0, 12),
    created_at: new Date().toISOString()
  };
  db.terminals.push(terminal);
  return terminal;
};

// CHECKINS
db.getCheckins = (filters = {}) => {
  let result = [...db.checkins];
  if (filters.employee_id)
    result = result.filter(c => c.employee_id === parseInt(filters.employee_id));
  if (filters.date)
    result = result.filter(c => c.ts.startsWith(filters.date));
  return result.sort((a, b) => new Date(b.ts) - new Date(a.ts));
};

db.getLastCheckin = (employee_id) => {
  const checkins = db.checkins
    .filter(c => c.employee_id === parseInt(employee_id))
    .sort((a, b) => new Date(b.ts) - new Date(a.ts));
  return checkins[0] || null;
};

db.createCheckin = (employee_id, terminal_id, direction) => {
  db._counters.checkins++;
  const checkin = {
    id: db._counters.checkins,
    employee_id: parseInt(employee_id),
    terminal_id: parseInt(terminal_id),
    direction,
    ts: new Date().toISOString()
  };
  db.checkins.push(checkin);
  return checkin;
};

// ADMINS
db.getAdminByUsername = (username) =>
  db.admins.find(a => a.username === username) || null;

module.exports = db;
