// tests/api.test.js — pruebas básicas de todos los endpoints
const request = require('supertest');
const app     = require('./app');

let adminToken = '';
const API_KEY  = 'terminal_key_123456';

// ── AUTH ─────────────────────────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
  test('login correcto devuelve token JWT', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'admin123' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty('token');
    adminToken = res.body.data.token; // guardamos para los siguientes tests
  });

  test('credenciales incorrectas devuelve 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'mala' });

    expect(res.statusCode).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  test('campos vacíos devuelve 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({});

    expect(res.statusCode).toBe(400);
  });
});

// ── EMPLOYEES ────────────────────────────────────────────────────────────────
describe('EMPLOYEES', () => {
  let newEmployeeId;
  let newEmployeeToken;

  test('GET /api/employees sin token devuelve 401', async () => {
    const res = await request(app).get('/api/employees');
    expect(res.statusCode).toBe(401);
  });

  test('GET /api/employees con token devuelve lista', async () => {
    const res = await request(app)
      .get('/api/employees')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('POST /api/employees crea empleado con qr_token único', async () => {
    const res = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'María Test' });

    expect(res.statusCode).toBe(201);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data).toHaveProperty('qr_token');
    expect(res.body.data.qr_token).toMatch(/^emp_[a-zA-Z0-9]+$/);

    newEmployeeId    = res.body.data.id;
    newEmployeeToken = res.body.data.qr_token;
  });

  test('POST /api/employees sin nombre devuelve 400', async () => {
    const res = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.statusCode).toBe(400);
  });

  test('GET /api/employees/:id devuelve el empleado correcto', async () => {
    const res = await request(app)
      .get(`/api/employees/${newEmployeeId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.name).toBe('María Test');
  });

  // ── CHECKINS ────────────────────────────────────────────────────────────────
  describe('CHECKINS', () => {
    test('POST /api/checkins sin X-API-Key devuelve 401', async () => {
      const res = await request(app)
        .post('/api/checkins')
        .send({ qr_token: newEmployeeToken });

      expect(res.statusCode).toBe(401);
    });

    test('POST /api/checkins primer fichaje es IN', async () => {
      const res = await request(app)
        .post('/api/checkins')
        .set('X-API-Key', API_KEY)
        .send({ qr_token: newEmployeeToken });

      expect(res.statusCode).toBe(201);
      expect(res.body.data.direction).toBe('IN');
    });

    test('POST /api/checkins segundo fichaje (inmediato) es DUPLICADO (409)', async () => {
      const res = await request(app)
        .post('/api/checkins')
        .set('X-API-Key', API_KEY)
        .send({ qr_token: newEmployeeToken });

      expect(res.statusCode).toBe(409);
    });

    test('POST /api/checkins token desconocido devuelve 404', async () => {
      const res = await request(app)
        .post('/api/checkins')
        .set('X-API-Key', API_KEY)
        .send({ qr_token: 'emp_tokenquenoexiste' });

      expect(res.statusCode).toBe(404); // token con formato válido pero no registrado en el sistema
    });

    test('GET /api/checkins devuelve lista de fichajes', async () => {
      const res = await request(app)
        .get('/api/checkins')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    test('GET /api/checkins filtra por fecha con formato correcto', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const res = await request(app)
        .get(`/api/checkins?date=${today}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
    });

    test('GET /api/checkins con fecha incorrecta devuelve 400', async () => {
      const res = await request(app)
        .get('/api/checkins?date=ayer')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(400);
    });
  });
});
