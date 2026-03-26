"""
Sistema de Fichaje con QR
Arranca con: python app.py
Abre en el navegador: http://localhost:5000
"""

from flask import Flask, request, jsonify, render_template, send_file, session, redirect, url_for
import sqlite3
import os
import uuid
from datetime import datetime
import qrcode
import io
from functools import wraps

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
            CREATE TABLE IF NOT EXISTS employees (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT    NOT NULL,
                qr_token   TEXT    NOT NULL UNIQUE,
                created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
            );

            CREATE TABLE IF NOT EXISTS checkins (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                employee_id INTEGER NOT NULL REFERENCES employees(id),
                direction   TEXT    NOT NULL CHECK(direction IN ('IN','OUT')),
                ts          TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
                lat         REAL,
                lng         REAL,
                store       TEXT
            );

            CREATE TABLE IF NOT EXISTS login_log (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                username  TEXT NOT NULL,
                rol       TEXT NOT NULL,
                ts        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                lat       REAL,
                lng       REAL
            );

            CREATE TABLE IF NOT EXISTS users (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                rol      TEXT NOT NULL DEFAULT 'empleado'
            );
        """)

        # Insertar admin por defecto si no existe
        existing = conn.execute("SELECT id FROM users WHERE username='admin'").fetchone()
        if not existing:
            conn.execute(
                "INSERT INTO users (username, password, rol) VALUES (?,?,?)",
                ("admin", "admin123", "admin")
            )

    os.makedirs(QR_FOLDER, exist_ok=True)


# ─────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────

def last_direction(conn, employee_id):
    row = conn.execute(
        "SELECT direction FROM checkins WHERE employee_id=? ORDER BY ts DESC LIMIT 1",
        (employee_id,)
    ).fetchone()
    return row["direction"] if row else None


def generate_qr_image(token: str) -> str:
    path = os.path.join(QR_FOLDER, f"{token}.png")
    if not os.path.exists(path):
        img = qrcode.make(token)
        img.save(path)
    return path


def require_login(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "username" not in session:
            return redirect(url_for("login_page"))
        return f(*args, **kwargs)
    return decorated


def require_admin(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if session.get("rol") != "admin":
            return jsonify({"error": "Acceso restringido a administradores"}), 403
        return f(*args, **kwargs)
    return decorated


# ─────────────────────────────────────────────
# RUTAS – AUTENTICACIÓN
# ─────────────────────────────────────────────

@app.route("/login", methods=["GET"])
def login_page():
    if "username" in session:
        return redirect(url_for("kiosk"))
    return render_template("index.html")


@app.route("/api/auth/login", methods=["POST"])
def api_login():
    data     = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()
    lat      = data.get("lat")
    lng      = data.get("lng")

    if not username or not password:
        return jsonify({"error": "Usuario y contraseña requeridos"}), 400

    with get_db() as conn:
        user = conn.execute(
            "SELECT * FROM users WHERE username=? AND password=?",
            (username, password)
        ).fetchone()

        if not user:
            return jsonify({"error": "Credenciales incorrectas"}), 401

        # Registrar log de login
        conn.execute(
            "INSERT INTO login_log (username, rol, lat, lng) VALUES (?,?,?,?)",
            (username, user["rol"], lat, lng)
        )

    session["username"]  = username
    session["rol"]       = user["rol"]
    session["login_time"] = datetime.now().strftime("%d/%m/%Y %H:%M")

    return jsonify({
        "username":   username,
        "rol":        user["rol"],
        "login_time": session["login_time"]
    })


@app.route("/api/auth/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/auth/me", methods=["GET"])
def api_me():
    if "username" not in session:
        return jsonify({"error": "No autenticado"}), 401
    return jsonify({
        "username":   session["username"],
        "rol":        session["rol"],
        "login_time": session.get("login_time", "")
    })


# ─────────────────────────────────────────────
# RUTAS – EMPLEADOS  (solo admin)
# ─────────────────────────────────────────────

@app.route("/api/employees", methods=["POST"])
@require_admin
def create_employee():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()

    if not name:
        return jsonify({"error": "El campo 'name' es obligatorio"}), 400
    if len(name) > 100:
        return jsonify({"error": "Nombre demasiado largo (máx. 100 caracteres)"}), 400

    token = uuid.uuid4().hex
    try:
        with get_db() as conn:
            conn.execute(
                "INSERT INTO employees (name, qr_token) VALUES (?, ?)",
                (name, token)
            )
    except sqlite3.IntegrityError:
        return jsonify({"error": "Ya existe un empleado con ese token"}), 409

    generate_qr_image(token)
    return jsonify({"message": "Empleado creado", "employee": {"name": name, "qr_token": token}}), 201


@app.route("/api/employees", methods=["GET"])
@require_admin
def list_employees():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, name, qr_token, created_at FROM employees ORDER BY name"
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/employees/<int:employee_id>", methods=["DELETE"])
@require_admin
def delete_employee(employee_id):
    with get_db() as conn:
        emp = conn.execute("SELECT qr_token FROM employees WHERE id=?", (employee_id,)).fetchone()
        if not emp:
            return jsonify({"error": "Empleado no encontrado"}), 404
        conn.execute("DELETE FROM checkins WHERE employee_id=?", (employee_id,))
        conn.execute("DELETE FROM employees WHERE id=?", (employee_id,))
        qr_path = os.path.join(QR_FOLDER, f"{emp['qr_token']}.png")
        if os.path.exists(qr_path):
            os.remove(qr_path)
    return jsonify({"message": "Empleado eliminado"})


@app.route("/api/employees/<int:employee_id>/qr")
@require_admin
def download_qr(employee_id):
    with get_db() as conn:
        emp = conn.execute("SELECT name, qr_token FROM employees WHERE id=?", (employee_id,)).fetchone()
    if not emp:
        return jsonify({"error": "Empleado no encontrado"}), 404
    path = generate_qr_image(emp["qr_token"])
    return send_file(path, mimetype="image/png",
                     download_name=f"qr_{emp['name'].replace(' ','_')}.png")


# ─────────────────────────────────────────────
# RUTAS – FICHAJES
# ─────────────────────────────────────────────

@app.route("/api/checkin", methods=["POST"])
def checkin():
    data  = request.get_json(silent=True) or {}
    token = (data.get("qr_token") or "").strip()
    lat   = data.get("lat")
    lng   = data.get("lng")
    store = (data.get("store") or "").strip() or None

    if not token:
        return jsonify({"error": "Token vacío"}), 400
    if len(token) != 32 or not token.isalnum():
        return jsonify({"error": "Formato de token inválido"}), 400

    with get_db() as conn:
        emp = conn.execute(
            "SELECT id, name FROM employees WHERE qr_token=?", (token,)
        ).fetchone()
        if not emp:
            return jsonify({"error": "Token no reconocido"}), 404

        recent = conn.execute("""
            SELECT ts FROM checkins WHERE employee_id=? ORDER BY ts DESC LIMIT 1
        """, (emp["id"],)).fetchone()

        if recent:
            last_ts = datetime.fromisoformat(recent["ts"])
            diff    = (datetime.now() - last_ts).total_seconds()
            if diff < 5:
                return jsonify({"error": "Fichaje duplicado, espera unos segundos"}), 429

        prev      = last_direction(conn, emp["id"])
        direction = "OUT" if prev == "IN" else "IN"
        now_str   = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        conn.execute(
            "INSERT INTO checkins (employee_id, direction, ts, lat, lng, store) VALUES (?,?,?,?,?,?)",
            (emp["id"], direction, now_str, lat, lng, store)
        )

    return jsonify({"employee": emp["name"], "direction": direction, "timestamp": now_str})


@app.route("/api/checkins", methods=["GET"])
@require_admin
def list_checkins():
    date_filter = request.args.get("date", "")
    emp_filter  = request.args.get("employee_id", "")

    query  = """
        SELECT c.id, e.name AS employee, c.direction, c.ts, c.lat, c.lng, c.store
        FROM checkins c JOIN employees e ON e.id = c.employee_id WHERE 1=1
    """
    params = []
    if date_filter:
        query += " AND DATE(c.ts) = ?"
        params.append(date_filter)
    if emp_filter:
        query += " AND c.employee_id = ?"
        params.append(emp_filter)
    query += " ORDER BY c.ts DESC LIMIT 500"

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/checkins/<int:checkin_id>", methods=["DELETE"])
@require_admin
def delete_checkin(checkin_id):
    with get_db() as conn:
        row = conn.execute("SELECT id FROM checkins WHERE id=?", (checkin_id,)).fetchone()
        if not row:
            return jsonify({"error": "Fichaje no encontrado"}), 404
        conn.execute("DELETE FROM checkins WHERE id=?", (checkin_id,))
    return jsonify({"message": "Fichaje eliminado"})


# ─────────────────────────────────────────────
# RUTAS – USUARIOS  (solo admin)
# ─────────────────────────────────────────────

@app.route("/api/users", methods=["GET"])
@require_admin
def list_users():
    with get_db() as conn:
        rows = conn.execute("SELECT id, username, rol FROM users ORDER BY username").fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/users", methods=["POST"])
@require_admin
def create_user():
    data     = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()
    rol      = data.get("rol", "empleado")

    if not username or not password:
        return jsonify({"error": "username y password son obligatorios"}), 400
    if rol not in ("admin", "empleado"):
        return jsonify({"error": "rol inválido"}), 400

    try:
        with get_db() as conn:
            conn.execute(
                "INSERT INTO users (username, password, rol) VALUES (?,?,?)",
                (username, password, rol)
            )
    except sqlite3.IntegrityError:
        return jsonify({"error": "El usuario ya existe"}), 409

    return jsonify({"message": f"Usuario '{username}' creado"}), 201


@app.route("/api/users/<int:user_id>", methods=["DELETE"])
@require_admin
def delete_user(user_id):
    with get_db() as conn:
        row = conn.execute("SELECT username FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            return jsonify({"error": "Usuario no encontrado"}), 404
        if row["username"] == "admin":
            return jsonify({"error": "No puedes eliminar el admin principal"}), 403
        conn.execute("DELETE FROM users WHERE id=?", (user_id,))
    return jsonify({"message": "Usuario eliminado"})


# ─────────────────────────────────────────────
# RUTAS – FRONTEND
# ─────────────────────────────────────────────

@app.route("/")
def kiosk():
    if "username" not in session:
        return redirect(url_for("login_page"))
    return render_template("kiosk.html")


@app.route("/admin")
def admin():
    if session.get("rol") != "admin":
        return redirect(url_for("login_page"))
    return render_template("admin.html")


# ─────────────────────────────────────────────
# ARRANQUE
# ─────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    print("\n Sistema de fichaje arrancado en http://localhost:5000")
    print(" Panel admin en http://localhost:5000/admin")
    print(" Credenciales por defecto → admin / admin123\n")
    app.run(debug=True, host="0.0.0.0", port=5000)
