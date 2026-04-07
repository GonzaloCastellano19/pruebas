// routes/checkins.js — registro de fichajes con lógica IN/OUT automática
const express      = require('express');
const router       = express.Router();
const { body, query, validationResult } = require('express-validator');
const apiKeyMiddleware  = require('../middleware/apiKey');
const authMiddleware    = require('../middleware/auth');
const db           = require('../db');

// POST /api/checkins — registrar fichaje (solo kiosco con X-API-Key)
router.post(
  '/',
  apiKeyMiddleware,
  [
    body('qr_token')
      .notEmpty().withMessage('El qr_token es obligatorio')
      .isLength({ min: 10, max: 100 }).withMessage('Formato de token inválido')
      .matches(/^emp_[a-zA-Z0-9]+$/).withMessage('El token no tiene el formato esperado')
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ error: errors.array()[0].msg });

    const { qr_token } = req.body;

    // 1. Buscar el empleado por token
    const employee = db.getEmployeeByToken(qr_token);
    if (!employee)
      return res.status(404).json({ error: 'Token QR no reconocido' });

    if (employee.status !== 'active')
      return res.status(403).json({ error: 'Empleado inactivo' });

    // 2. Protección contra fichajes duplicados en menos de 10 segundos
    const lastCheckin = db.getLastCheckin(employee.id);
    if (lastCheckin) {
      const segundosDiferencia = (Date.now() - new Date(lastCheckin.ts).getTime()) / 1000;
      if (segundosDiferencia < 10) {
        return res.status(409).json({
          error: 'Fichaje duplicado: espera al menos 10 segundos entre fichajes'
        });
      }
    }

    // 3. Decidir dirección IN/OUT automáticamente
    const direction = (!lastCheckin || lastCheckin.direction === 'OUT') ? 'IN' : 'OUT';

    // 4. Registrar el fichaje
    const checkin = db.createCheckin(employee.id, req.terminal.id, direction);

    res.status(201).json({
      data: {
        id: checkin.id,
        employee: { id: employee.id, name: employee.name },
        terminal: { id: req.terminal.id, name: req.terminal.name },
        direction,
        ts: checkin.ts
      }
    });
  }
);

// GET /api/checkins — consultar fichajes (requiere JWT admin)
router.get(
  '/',
  authMiddleware,
  [
    query('date')
      .optional()
      .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('La fecha debe tener formato YYYY-MM-DD'),
    query('employee_id')
      .optional()
      .isInt({ min: 1 }).withMessage('employee_id debe ser un número positivo'),
    query('page')
      .optional()
      .isInt({ min: 1 })
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ error: errors.array()[0].msg });

    const filters = {
      date: req.query.date,
      employee_id: req.query.employee_id
    };

    const checkins = db.getCheckins(filters);

    // Enriquecer con nombres de empleado y terminal
    const enriched = checkins.map(c => ({
      ...c,
      employee_name: db.getEmployeeById(c.employee_id)?.name || 'Desconocido',
      terminal_name: db.terminals.find(t => t.id === c.terminal_id)?.name || 'Desconocido'
    }));

    res.json({ data: enriched });
  }
);

module.exports = router;
