// routes/terminals.js — CRUD de terminales/kioscos
const express   = require('express');
const router    = express.Router();
const { body, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/auth');
const db        = require('../db');

// GET /api/terminals — listar terminales
router.get('/', authMiddleware, (req, res) => {
  const terminals = db.getTerminals();
  res.json({ data: terminals });
});

// POST /api/terminals — crear terminal
router.post(
  '/',
  authMiddleware,
  [
    body('name')
      .notEmpty().withMessage('El nombre del terminal es obligatorio')
      .isLength({ min: 2, max: 100 }).trim(),
    body('location')
      .optional()
      .isLength({ max: 200 }).trim()
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ error: errors.array()[0].msg });

    const terminal = db.createTerminal(req.body.name, req.body.location);
    res.status(201).json({ data: terminal });
  }
);

module.exports = router;
