# Backend — Lector QR para Fichar

API REST con Node.js + Express. Sin base de datos por ahora (datos en memoria).

## Instalación

```bash
cd backend
npm install
```

## Arrancar el servidor

```bash
npm run dev     # con recarga automática (nodemon)
npm start       # producción
```

El servidor arranca en **http://localhost:3000**

## Credenciales de prueba

| Rol | Credencial |
|-----|-----------|
| Admin | usuario: `admin` / contraseña: `admin123` |
| Kiosco | Header: `X-API-Key: terminal_key_123456` |

## Endpoints disponibles

### Auth
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/login` | Obtener token JWT |

### Empleados (requiere JWT)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/employees` | Listar empleados |
| GET | `/api/employees/:id` | Ver empleado |
| GET | `/api/employees/:id/qr` | Ver token QR |
| POST | `/api/employees` | Crear empleado |
| PUT | `/api/employees/:id` | Editar empleado |
| DELETE | `/api/employees/:id` | Eliminar empleado |

### Terminales (requiere JWT)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/terminals` | Listar terminales |
| POST | `/api/terminals` | Crear terminal |

### Fichajes
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/checkins` | Registrar fichaje (requiere X-API-Key) |
| GET | `/api/checkins` | Consultar fichajes (requiere JWT) |

## Ejecutar tests

```bash
npm test
```

## Próximo paso — Sprint 2

Conectar SQLite sustituyendo `src/db.js` por `better-sqlite3`.
