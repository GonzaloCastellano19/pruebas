"""
Sistema de Fichaje con QR
Nueva estructura: Admins → Empresas → Departamentos → Usuarios → Fichajes
Arranca con: python app.py
"""

from flask import Flask, request, jsonify, render_template, send_file, session, redirect, url_for
import sqlite3
import os
import uuid
from datetime import datetime
import qrcode
from functools import wraps
import hashlib

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "cambiar_en_produccion_" + uuid.uuid4().hex)

DB_PATH   = "fichaje.db"
QR_FOLDER = "static/qr_codes"


# ─────────────────────────────────────────────
# BASE DE DATOS
# ─────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with get_db() as conn:
        conn.executescript("""
            -- Admins del sistema
            CREATE TABLE IF NOT EXISTS admins (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre     TEXT    NOT NULL,
                correo     TEXT    NOT NULL UNIQUE,
                password   TEXT    NOT NULL,
                telefono   TEXT,
                created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
                updated_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
            );

            -- Empresas que gestiona cada admin
            CREATE TABLE IF NOT EXISTS empresas (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                admin_id   INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
                nombre     TEXT    NOT NULL,
                nif        TEXT,
                direccion  TEXT,
                sector     TEXT,
                created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
            );

            -- Departamentos dentro de cada empresa
            CREATE TABLE IF NOT EXISTS departamentos (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
                nombre     TEXT    NOT NULL,
                descripcion TEXT,
                created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
            );

            -- Usuarios (empleados) de cada departamento
            CREATE TABLE IF NOT EXISTS usuarios (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                empresa_id      INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
                departamento_id INTEGER NOT NULL REFERENCES departamentos(id) ON DELETE CASCADE,
                dni             TEXT    NOT NULL UNIQUE,
                nombre          TEXT    NOT NULL,
                apellidos       TEXT,
                correo          TEXT,
                telefono        TEXT,
                rol             TEXT    NOT NULL DEFAULT 'empleado',
                qr_token        TEXT    NOT NULL UNIQUE,
                created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
            );

            -- Fichajes vinculados a usuario, departamento y empresa
            CREATE TABLE IF NOT EXISTS fichajes (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                usuario_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
                departamento_id INTEGER NOT NULL REFERENCES departamentos(id) ON DELETE CASCADE,
                empresa_id      INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
                entrada         TEXT    NOT NULL,
                salida          TEXT,
                tipo            TEXT    NOT NULL DEFAULT 'presencial' CHECK(tipo IN ('presencial','remoto')),
                ubicacion       TEXT,
                estado          TEXT    NOT NULL DEFAULT 'abierto' CHECK(estado IN ('abierto','cerrado')),
                created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
            );
        """)

        # Admin por defecto si no existe
        existing = conn.execute("SELECT id FROM admins WHERE correo='admin@admin.com'").fetchone()
        if not existing:
            pwd_hash = hashlib.sha256("admin123".encode()).hexdigest()
            conn.execute(
                "INSERT INTO admins (nombre, correo, password, telefono) VALUES (?,?,?,?)",
                ("Administrador", "admin@admin.com", pwd_hash, "")
            )

    os.makedirs(QR_FOLDER, exist_ok=True)


# ─────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────

def hash_password(pwd):
    return hashlib.sha256(pwd.encode()).hexdigest()


def generate_qr_image(token: str) -> str:
    path = os.path.join(QR_FOLDER, f"{token}.png")
    if not os.path.exists(path):
        img = qrcode.make(token)
        img.save(path)
    return path


def require_login(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "admin_id" not in session:
            return redirect(url_for("login_page"))
        return f(*args, **kwargs)
    return decorated


def require_api_login(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "admin_id" not in session:
            return jsonify({"error": "No autenticado"}), 401
        return f(*args, **kwargs)
    return decorated


# ─────────────────────────────────────────────
# RUTAS – FRONTEND
# ─────────────────────────────────────────────

@app.route("/")
def index():
    if "admin_id" in session:
        return redirect(url_for("admin_panel"))
    return redirect(url_for("login_page"))


@app.route("/login")
def login_page():
    if "admin_id" in session:
        return redirect(url_for("admin_panel"))
    return render_template("index.html")


@app.route("/admin")
@require_login
def admin_panel():
    return render_template("admin.html")


@app.route("/kiosk")
def kiosk():
    return render_template("kiosk.html")


# ─────────────────────────────────────────────
# RUTAS – AUTH
# ─────────────────────────────────────────────

@app.route("/api/auth/login", methods=["POST"])
def api_login():
    data     = request.get_json(silent=True) or {}
    correo   = (data.get("correo") or data.get("username") or "").strip()
    password = (data.get("password") or "").strip()

    if not correo or not password:
        return jsonify({"error": "Correo y contraseña requeridos"}), 400

    with get_db() as conn:
        admin = conn.execute(
            "SELECT * FROM admins WHERE correo=? AND password=?",
            (correo, hash_password(password))
        ).fetchone()

        if not admin:
            return jsonify({"error": "Credenciales incorrectas"}), 401

    session["admin_id"]   = admin["id"]
    session["admin_nombre"] = admin["nombre"]
    session["admin_correo"] = admin["correo"]

    return jsonify({
        "ok": True,
        "admin": {"id": admin["id"], "nombre": admin["nombre"], "correo": admin["correo"]}
    })


@app.route("/api/auth/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/auth/me", methods=["GET"])
def api_me():
    if "admin_id" not in session:
        return jsonify({"error": "No autenticado"}), 401
    return jsonify({
        "id":     session["admin_id"],
        "nombre": session["admin_nombre"],
        "correo": session["admin_correo"]
    })


# ─────────────────────────────────────────────
# RUTAS – ADMINS
# ─────────────────────────────────────────────

@app.route("/api/admins", methods=["POST"])
def create_admin():
    """Crea un nuevo admin (registro público o desde superadmin)."""
    data     = request.get_json(silent=True) or {}
    nombre   = (data.get("nombre") or "").strip()
    correo   = (data.get("correo") or "").strip()
    password = (data.get("password") or "").strip()
    telefono = (data.get("telefono") or "").strip()

    if not nombre or not correo or not password:
        return jsonify({"error": "nombre, correo y password son obligatorios"}), 400

    try:
        with get_db() as conn:
            conn.execute(
                "INSERT INTO admins (nombre, correo, password, telefono) VALUES (?,?,?,?)",
                (nombre, correo, hash_password(password), telefono)
            )
    except sqlite3.IntegrityError:
        return jsonify({"error": "Ya existe un admin con ese correo"}), 409

    return jsonify({"message": f"Admin '{nombre}' creado correctamente"}), 201


@app.route("/api/admins/me", methods=["PUT"])
@require_api_login
def update_admin():
    """Actualiza los datos del admin en sesión."""
    data     = request.get_json(silent=True) or {}
    nombre   = (data.get("nombre") or "").strip()
    telefono = (data.get("telefono") or "").strip()
    password = (data.get("password") or "").strip()

    fields, params = [], []
    if nombre:
        fields.append("nombre=?"); params.append(nombre)
    if telefono:
        fields.append("telefono=?"); params.append(telefono)
    if password:
        fields.append("password=?"); params.append(hash_password(password))
    fields.append("updated_at=?"); params.append(datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    params.append(session["admin_id"])

    with get_db() as conn:
        conn.execute(f"UPDATE admins SET {', '.join(fields)} WHERE id=?", params)
        if nombre:
            session["admin_nombre"] = nombre

    return jsonify({"ok": True})


# ─────────────────────────────────────────────
# RUTAS – EMPRESAS
# ─────────────────────────────────────────────

@app.route("/api/empresas", methods=["GET"])
@require_api_login
def list_empresas():
    """Lista las empresas del admin en sesión."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM empresas WHERE admin_id=? ORDER BY nombre",
            (session["admin_id"],)
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/empresas", methods=["POST"])
@require_api_login
def create_empresa():
    data      = request.get_json(silent=True) or {}
    nombre    = (data.get("nombre") or "").strip()
    nif       = (data.get("nif") or "").strip()
    direccion = (data.get("direccion") or "").strip()
    sector    = (data.get("sector") or "").strip()

    if not nombre:
        return jsonify({"error": "El nombre de la empresa es obligatorio"}), 400

    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO empresas (admin_id, nombre, nif, direccion, sector) VALUES (?,?,?,?,?)",
            (session["admin_id"], nombre, nif, direccion, sector)
        )
        empresa_id = cur.lastrowid

    return jsonify({"id": empresa_id, "nombre": nombre, "message": "Empresa creada"}), 201


@app.route("/api/empresas/<int:empresa_id>", methods=["PUT"])
@require_api_login
def update_empresa(empresa_id):
    data = request.get_json(silent=True) or {}
    with get_db() as conn:
        emp = conn.execute(
            "SELECT id FROM empresas WHERE id=? AND admin_id=?",
            (empresa_id, session["admin_id"])
        ).fetchone()
        if not emp:
            return jsonify({"error": "Empresa no encontrada"}), 404
        conn.execute(
            "UPDATE empresas SET nombre=?, nif=?, direccion=?, sector=? WHERE id=?",
            (data.get("nombre",""), data.get("nif",""), data.get("direccion",""), data.get("sector",""), empresa_id)
        )
    return jsonify({"ok": True})


@app.route("/api/empresas/<int:empresa_id>", methods=["DELETE"])
@require_api_login
def delete_empresa(empresa_id):
    with get_db() as conn:
        emp = conn.execute(
            "SELECT id FROM empresas WHERE id=? AND admin_id=?",
            (empresa_id, session["admin_id"])
        ).fetchone()
        if not emp:
            return jsonify({"error": "Empresa no encontrada"}), 404
        conn.execute("DELETE FROM empresas WHERE id=?", (empresa_id,))
    return jsonify({"message": "Empresa eliminada"})


# ─────────────────────────────────────────────
# RUTAS – DEPARTAMENTOS
# ─────────────────────────────────────────────

@app.route("/api/empresas/<int:empresa_id>/departamentos", methods=["GET"])
@require_api_login
def list_departamentos(empresa_id):
    with get_db() as conn:
        # Verificar que la empresa pertenece al admin
        emp = conn.execute(
            "SELECT id FROM empresas WHERE id=? AND admin_id=?",
            (empresa_id, session["admin_id"])
        ).fetchone()
        if not emp:
            return jsonify({"error": "Empresa no encontrada"}), 404

        rows = conn.execute(
            "SELECT * FROM departamentos WHERE empresa_id=? ORDER BY nombre",
            (empresa_id,)
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/empresas/<int:empresa_id>/departamentos", methods=["POST"])
@require_api_login
def create_departamento(empresa_id):
    data        = request.get_json(silent=True) or {}
    nombre      = (data.get("nombre") or "").strip()
    descripcion = (data.get("descripcion") or "").strip()

    if not nombre:
        return jsonify({"error": "El nombre del departamento es obligatorio"}), 400

    with get_db() as conn:
        emp = conn.execute(
            "SELECT id FROM empresas WHERE id=? AND admin_id=?",
            (empresa_id, session["admin_id"])
        ).fetchone()
        if not emp:
            return jsonify({"error": "Empresa no encontrada"}), 404

        cur = conn.execute(
            "INSERT INTO departamentos (empresa_id, nombre, descripcion) VALUES (?,?,?)",
            (empresa_id, nombre, descripcion)
        )
        depto_id = cur.lastrowid

    return jsonify({"id": depto_id, "nombre": nombre, "message": "Departamento creado"}), 201


@app.route("/api/departamentos/<int:depto_id>", methods=["DELETE"])
@require_api_login
def delete_departamento(depto_id):
    with get_db() as conn:
        row = conn.execute("""
            SELECT d.id FROM departamentos d
            JOIN empresas e ON e.id = d.empresa_id
            WHERE d.id=? AND e.admin_id=?
        """, (depto_id, session["admin_id"])).fetchone()
        if not row:
            return jsonify({"error": "Departamento no encontrado"}), 404
        conn.execute("DELETE FROM departamentos WHERE id=?", (depto_id,))
    return jsonify({"message": "Departamento eliminado"})


# ─────────────────────────────────────────────
# RUTAS – USUARIOS
# ─────────────────────────────────────────────

@app.route("/api/departamentos/<int:depto_id>/usuarios", methods=["GET"])
@require_api_login
def list_usuarios(depto_id):
    with get_db() as conn:
        rows = conn.execute("""
            SELECT u.id, u.dni, u.nombre, u.apellidos, u.correo,
                   u.telefono, u.rol, u.qr_token, u.created_at,
                   d.nombre AS departamento, e.nombre AS empresa
            FROM usuarios u
            JOIN departamentos d ON d.id = u.departamento_id
            JOIN empresas e ON e.id = u.empresa_id
            WHERE u.departamento_id=? AND e.admin_id=?
            ORDER BY u.nombre
        """, (depto_id, session["admin_id"])).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/empresas/<int:empresa_id>/usuarios", methods=["GET"])
@require_api_login
def list_usuarios_empresa(empresa_id):
    """Todos los usuarios de una empresa (todos los departamentos)."""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT u.id, u.dni, u.nombre, u.apellidos, u.correo,
                   u.telefono, u.rol, u.qr_token, u.created_at,
                   d.nombre AS departamento, d.id AS departamento_id
            FROM usuarios u
            JOIN departamentos d ON d.id = u.departamento_id
            JOIN empresas e ON e.id = u.empresa_id
            WHERE u.empresa_id=? AND e.admin_id=?
            ORDER BY d.nombre, u.nombre
        """, (empresa_id, session["admin_id"])).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/departamentos/<int:depto_id>/usuarios", methods=["POST"])
@require_api_login
def create_usuario(depto_id):
    data      = request.get_json(silent=True) or {}
    dni       = (data.get("dni") or "").strip()
    nombre    = (data.get("nombre") or "").strip()
    apellidos = (data.get("apellidos") or "").strip()
    correo    = (data.get("correo") or "").strip()
    telefono  = (data.get("telefono") or "").strip()
    rol       = data.get("rol", "empleado")

    if not dni or not nombre:
        return jsonify({"error": "dni y nombre son obligatorios"}), 400

    with get_db() as conn:
        # Obtener empresa_id del departamento y verificar pertenencia
        depto = conn.execute("""
            SELECT d.id, d.empresa_id FROM departamentos d
            JOIN empresas e ON e.id = d.empresa_id
            WHERE d.id=? AND e.admin_id=?
        """, (depto_id, session["admin_id"])).fetchone()
        if not depto:
            return jsonify({"error": "Departamento no encontrado"}), 404

        qr_token = "usr_" + uuid.uuid4().hex
        try:
            cur = conn.execute("""
                INSERT INTO usuarios
                (empresa_id, departamento_id, dni, nombre, apellidos, correo, telefono, rol, qr_token)
                VALUES (?,?,?,?,?,?,?,?,?)
            """, (depto["empresa_id"], depto_id, dni, nombre, apellidos, correo, telefono, rol, qr_token))
            usuario_id = cur.lastrowid
        except sqlite3.IntegrityError:
            return jsonify({"error": "Ya existe un usuario con ese DNI"}), 409

    generate_qr_image(qr_token)
    return jsonify({
        "id": usuario_id,
        "nombre": nombre,
        "qr_token": qr_token,
        "message": "Usuario creado"
    }), 201


@app.route("/api/usuarios/<int:usuario_id>", methods=["PUT"])
@require_api_login
def update_usuario(usuario_id):
    data = request.get_json(silent=True) or {}
    with get_db() as conn:
        u = conn.execute("""
            SELECT u.id FROM usuarios u
            JOIN empresas e ON e.id = u.empresa_id
            WHERE u.id=? AND e.admin_id=?
        """, (usuario_id, session["admin_id"])).fetchone()
        if not u:
            return jsonify({"error": "Usuario no encontrado"}), 404

        conn.execute("""
            UPDATE usuarios SET nombre=?, apellidos=?, correo=?,
            telefono=?, rol=?, departamento_id=? WHERE id=?
        """, (
            data.get("nombre",""), data.get("apellidos",""),
            data.get("correo",""), data.get("telefono",""),
            data.get("rol","empleado"), data.get("departamento_id"), usuario_id
        ))
    return jsonify({"ok": True})


@app.route("/api/usuarios/<int:usuario_id>", methods=["DELETE"])
@require_api_login
def delete_usuario(usuario_id):
    with get_db() as conn:
        u = conn.execute("""
            SELECT u.qr_token FROM usuarios u
            JOIN empresas e ON e.id = u.empresa_id
            WHERE u.id=? AND e.admin_id=?
        """, (usuario_id, session["admin_id"])).fetchone()
        if not u:
            return jsonify({"error": "Usuario no encontrado"}), 404

        conn.execute("DELETE FROM usuarios WHERE id=?", (usuario_id,))
        qr_path = os.path.join(QR_FOLDER, f"{u['qr_token']}.png")
        if os.path.exists(qr_path):
            os.remove(qr_path)
    return jsonify({"message": "Usuario eliminado"})


@app.route("/api/usuarios/<int:usuario_id>/qr")
@require_api_login
def download_qr_usuario(usuario_id):
    with get_db() as conn:
        u = conn.execute("""
            SELECT u.nombre, u.qr_token FROM usuarios u
            JOIN empresas e ON e.id = u.empresa_id
            WHERE u.id=? AND e.admin_id=?
        """, (usuario_id, session["admin_id"])).fetchone()
    if not u:
        return jsonify({"error": "Usuario no encontrado"}), 404

    path = generate_qr_image(u["qr_token"])
    return send_file(path, mimetype="image/png",
                     download_name=f"qr_{u['nombre'].replace(' ','_')}.png")


# ─────────────────────────────────────────────
# RUTAS – FICHAJES
# ─────────────────────────────────────────────

@app.route("/api/checkin", methods=["POST"])
def checkin():
    """
    El kiosco escanea el QR del usuario.
    Registra entrada (IN) o salida (OUT) automáticamente.
    El fichaje queda vinculado al departamento y empresa del usuario.
    """
    data  = request.get_json(silent=True) or {}
    token = (data.get("qr_token") or "").strip()
    tipo  = data.get("tipo", "presencial")
    ubicacion = (data.get("ubicacion") or "").strip()

    if not token:
        return jsonify({"error": "Token vacío"}), 400

    with get_db() as conn:
        usuario = conn.execute("""
            SELECT u.id, u.nombre, u.apellidos, u.departamento_id, u.empresa_id,
                   d.nombre AS departamento, e.nombre AS empresa
            FROM usuarios u
            JOIN departamentos d ON d.id = u.departamento_id
            JOIN empresas e ON e.id = u.empresa_id
            WHERE u.qr_token=?
        """, (token,)).fetchone()

        if not usuario:
            return jsonify({"error": "Token QR no reconocido"}), 404

        # Protección anti-duplicado (5 segundos)
        recent = conn.execute("""
            SELECT created_at FROM fichajes WHERE usuario_id=?
            ORDER BY created_at DESC LIMIT 1
        """, (usuario["id"],)).fetchone()

        if recent:
            diff = (datetime.now() - datetime.fromisoformat(recent["created_at"])).total_seconds()
            if diff < 5:
                return jsonify({"error": "Fichaje duplicado, espera unos segundos"}), 429

        # Buscar si tiene fichaje abierto HOY
        hoy = datetime.now().strftime("%Y-%m-%d")
        fichaje_abierto = conn.execute("""
            SELECT id FROM fichajes
            WHERE usuario_id=? AND estado='abierto' AND DATE(entrada)=?
        """, (usuario["id"], hoy)).fetchone()

        ahora = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        if fichaje_abierto:
            # Cerrar fichaje (OUT)
            conn.execute("""
                UPDATE fichajes SET salida=?, estado='cerrado' WHERE id=?
            """, (ahora, fichaje_abierto["id"]))
            direction = "OUT"
        else:
            # Abrir fichaje (IN)
            conn.execute("""
                INSERT INTO fichajes
                (usuario_id, departamento_id, empresa_id, entrada, tipo, ubicacion, estado)
                VALUES (?,?,?,?,?,?,'abierto')
            """, (usuario["id"], usuario["departamento_id"], usuario["empresa_id"],
                  ahora, tipo, ubicacion))
            direction = "IN"

    return jsonify({
        "direction": direction,
        "usuario":   f"{usuario['nombre']} {usuario['apellidos'] or ''}".strip(),
        "departamento": usuario["departamento"],
        "empresa":   usuario["empresa"],
        "timestamp": ahora
    })


@app.route("/api/fichajes", methods=["GET"])
@require_api_login
def list_fichajes():
    """
    Devuelve fichajes del admin con filtros opcionales.
    ?empresa_id=1  &departamento_id=2  &usuario_id=3  &fecha=YYYY-MM-DD  &estado=abierto
    """
    empresa_id    = request.args.get("empresa_id")
    depto_id      = request.args.get("departamento_id")
    usuario_id    = request.args.get("usuario_id")
    fecha         = request.args.get("fecha")
    estado        = request.args.get("estado")

    query = """
        SELECT f.id, f.entrada, f.salida, f.tipo, f.ubicacion, f.estado, f.created_at,
               u.nombre AS usuario_nombre, u.apellidos AS usuario_apellidos, u.dni,
               d.nombre AS departamento, d.id AS departamento_id,
               e.nombre AS empresa, e.id AS empresa_id
        FROM fichajes f
        JOIN usuarios u ON u.id = f.usuario_id
        JOIN departamentos d ON d.id = f.departamento_id
        JOIN empresas e ON e.id = f.empresa_id
        WHERE e.admin_id=?
    """
    params = [session["admin_id"]]

    if empresa_id:
        query += " AND f.empresa_id=?";    params.append(empresa_id)
    if depto_id:
        query += " AND f.departamento_id=?"; params.append(depto_id)
    if usuario_id:
        query += " AND f.usuario_id=?";    params.append(usuario_id)
    if fecha:
        query += " AND DATE(f.entrada)=?"; params.append(fecha)
    if estado:
        query += " AND f.estado=?";        params.append(estado)

    query += " ORDER BY f.entrada DESC LIMIT 1000"

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()

    return jsonify([dict(r) for r in rows])


@app.route("/api/fichajes/<int:fichaje_id>/cerrar", methods=["PATCH"])
@require_api_login
def cerrar_fichaje(fichaje_id):
    """Cierra manualmente un fichaje abierto (el admin puede hacerlo)."""
    ahora = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with get_db() as conn:
        row = conn.execute("""
            SELECT f.id FROM fichajes f
            JOIN empresas e ON e.id = f.empresa_id
            WHERE f.id=? AND e.admin_id=? AND f.estado='abierto'
        """, (fichaje_id, session["admin_id"])).fetchone()
        if not row:
            return jsonify({"error": "Fichaje no encontrado o ya cerrado"}), 404
        conn.execute(
            "UPDATE fichajes SET salida=?, estado='cerrado' WHERE id=?",
            (ahora, fichaje_id)
        )
    return jsonify({"ok": True, "salida": ahora})


@app.route("/api/fichajes/<int:fichaje_id>", methods=["DELETE"])
@require_api_login
def delete_fichaje(fichaje_id):
    with get_db() as conn:
        row = conn.execute("""
            SELECT f.id FROM fichajes f
            JOIN empresas e ON e.id = f.empresa_id
            WHERE f.id=? AND e.admin_id=?
        """, (fichaje_id, session["admin_id"])).fetchone()
        if not row:
            return jsonify({"error": "Fichaje no encontrado"}), 404
        conn.execute("DELETE FROM fichajes WHERE id=?", (fichaje_id,))
    return jsonify({"message": "Fichaje eliminado"})


# ─────────────────────────────────────────────
# ARRANQUE
# ─────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    print("\n Sistema de fichaje arrancado en http://localhost:5000")
    print(" Panel admin:  http://localhost:5000/admin")
    print(" Kiosco:       http://localhost:5000/kiosk")
    print(" Login:        admin@admin.com / admin123\n")
    app.run(debug=True, host="0.0.0.0", port=5000)
