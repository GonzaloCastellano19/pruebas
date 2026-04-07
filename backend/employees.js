// routes/employees.js — CRUD de empleados
const express   = require('express');
const router    = express.Router();
const { body, query, param, validationResult } = require('express-validator');
const authMiddleware = require('./auth');
const db        = require('./db');

// GET /api/employees — listar empleados (requiere JWT admin)
router.get(
  '/',
  authMiddleware,
  [
    query('page').optional().isInt({ min: 1 }).withMessage('page debe ser un número positivo'),
    query('pageSize').optional().isInt({ min: 1, max: 100 })
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ error: errors.array()[0].msg });

    const page     = parseInt(req.query.page)     || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    const employees = db.getEmployees(page, pageSize);

    res.json({ data: employees });
  }
);

// GET /api/employees/:id — obtener un empleado por ID
router.get(
  '/:id',
  authMiddleware,
  [param('id').isInt().withMessage('ID debe ser un número')],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ error: errors.array()[0].msg });

    const employee = db.getEmployeeById(req.params.id);
    if (!employee)
      return res.status(404).json({ error: 'Empleado no encontrado' });

    res.json({ data: employee });
  }
);

// POST /api/employees — crear empleado (requiere JWT admin)
router.post(
  '/',
  authMiddleware,
  [
    body('name')
      .notEmpty().withMessage('El nombre es obligatorio')
      .isLength({ min: 2, max: 100 }).withMessage('El nombre debe tener entre 2 y 100 caracteres')
      .trim()
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ error: errors.array()[0].msg });

    const employee = db.createEmployee(req.body.name);
    res.status(201).json({ data: employee });
  }
);

// PUT /api/employees/:id — actualizar empleado
router.put(
  '/:id',
  authMiddleware,
  [
    param('id').isInt().withMessage('ID debe ser un número'),
    body('name').optional().isLength({ min: 2, max: 100 }).trim(),
    body('status').optional().isIn(['active', 'inactive']).withMessage('Status debe ser active o inactive')
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ error: errors.array()[0].msg });

    const updated = db.updateEmployee(req.params.id, req.body);
    if (!updated)
      return res.status(404).json({ error: 'Empleado no encontrado' });

    res.json({ data: updated });
  }
);

// DELETE /api/employees/:id — eliminar empleado
router.delete(
  '/:id',
  authMiddleware,
  [param('id').isInt().withMessage('ID debe ser un número')],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ error: errors.array()[0].msg });

    const deleted = db.deleteEmployee(req.params.id);
    if (!deleted)
      return res.status(404).json({ error: 'Empleado no encontrado' });

    res.json({ data: { message: 'Empleado eliminado correctamente' } });
  }
);

// GET /api/employees/:id/qr — devuelve el qr_token (cuando conectes BD generarás la imagen)
router.get(
  '/:id/qr',
  authMiddleware,
  [param('id').isInt().withMessage('ID debe ser un número')],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ error: errors.array()[0].msg });

    const employee = db.getEmployeeById(req.params.id);
    if (!employee)
      return res.status(404).json({ error: 'Empleado no encontrado' });

    // Por ahora devuelve el token. En Sprint 2 generarás la imagen PNG real.
    res.json({
      data: {
        employee_id: employee.id,
        name: employee.name,
        qr_token: employee.qr_token,
        note: 'Conecta el generador de QR en Sprint 2 para obtener la imagen PNG'
      }
    });
  }
);

module.exports = router;
