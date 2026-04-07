"""
Sistema de Fichaje con QR
Arranca con: python app.py
Abre en el navegador: http://localhost:5000
"""

from flask import Flask, request, jsonify, render_template, send_file
import sqlite3
import os
import uuid
from datetime import datetime
import qrcode
import io

app = Flask(__name__)

DB_PATH = "fichaje.db"
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
    """Crea las tablas si no existen."""
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
                ts          TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
            );
        """)
    os.makedirs(QR_FOLDER, exist_ok=True)


# ─────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────

def last_direction(conn, employee_id):
    """Devuelve 'IN', 'OUT', o None si no hay fichajes previos."""
    row = conn.execute(
        "SELECT direction FROM checkins WHERE employee_id=? ORDER BY ts DESC LIMIT 1",
        (employee_id,)
    ).fetchone()
    return row["direction"] if row else None


def generate_qr_image(token: str) -> str:
    """Genera imagen QR y la guarda. Devuelve la ruta relativa."""
    path = os.path.join(QR_FOLDER, f"{token}.png")
    if not os.path.exists(path):
        img = qrcode.make(token)
        img.save(path)
    return path


# ─────────────────────────────────────────────
# RUTAS – EMPLEADOS
# ─────────────────────────────────────────────

@app.route("/api/employees", methods=["POST"])
def create_employee():
    """Crea un empleado y genera su QR."""
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()

    if not name:
        return jsonify({"error": "El campo 'name' es obligatorio"}), 400
    if len(name) > 100:
        return jsonify({"error": "Nombre demasiado largo (máx. 100 caracteres)"}), 400

    token = uuid.uuid4().hex  # token aleatorio de 32 caracteres

    try:
        with get_db() as conn:
            conn.execute(
                "INSERT INTO employees (name, qr_token) VALUES (?, ?)",
                (name, token)
            )
    except sqlite3.IntegrityError:
        return jsonify({"error": "Ya existe un empleado con ese token"}), 409

    # Genera el QR en disco
    generate_qr_image(token)

    return jsonify({
        "message": "Empleado creado",
        "employee": {"name": name, "qr_token": token}
    }), 201


@app.route("/api/employees", methods=["GET"])
def list_employees():
    """Lista todos los empleados."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, name, qr_token, created_at FROM employees ORDER BY name"
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/employees/<int:employee_id>", methods=["DELETE"])
def delete_employee(employee_id):
    """Elimina un empleado y sus fichajes."""
    with get_db() as conn:
        emp = conn.execute(
            "SELECT qr_token FROM employees WHERE id=?", (employee_id,)
        ).fetchone()
        if not emp:
            return jsonify({"error": "Empleado no encontrado"}), 404

        conn.execute("DELETE FROM checkins WHERE employee_id=?", (employee_id,))
        conn.execute("DELETE FROM employees WHERE id=?", (employee_id,))

        # Borra el archivo QR si existe
        qr_path = os.path.join(QR_FOLDER, f"{emp['qr_token']}.png")
        if os.path.exists(qr_path):
            os.remove(qr_path)

    return jsonify({"message": "Empleado eliminado"})


# ─────────────────────────────────────────────
# RUTAS – QR
# ─────────────────────────────────────────────

@app.route("/api/employees/<int:employee_id>/qr")
def download_qr(employee_id):
    """Descarga la imagen QR de un empleado."""
    with get_db() as conn:
        emp = conn.execute(
            "SELECT name, qr_token FROM employees WHERE id=?", (employee_id,)
        ).fetchone()
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
    """
    Recibe un qr_token, decide IN/OUT automáticamente
    y registra el fichaje.
    """
    data = request.get_json(silent=True) or {}
    token = (data.get("qr_token") or "").strip()

    # Validación básica del token
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

        # Protección anti-duplicado: rechaza si el último fichaje fue hace < 5 segundos
        recent = conn.execute("""
            SELECT ts FROM checkins
            WHERE employee_id=?
            ORDER BY ts DESC LIMIT 1
        """, (emp["id"],)).fetchone()

        if recent:
            last_ts = datetime.fromisoformat(recent["ts"])
            diff = (datetime.now() - last_ts).total_seconds()
            if diff < 5:
                return jsonify({"error": "Fichaje duplicado, espera unos segundos"}), 429

        # Lógica IN/OUT automática
        prev = last_direction(conn, emp["id"])
        direction = "OUT" if prev == "IN" else "IN"

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        conn.execute(
            "INSERT INTO checkins (employee_id, direction, ts) VALUES (?,?,?)",
            (emp["id"], direction, now_str)
        )

    return jsonify({
        "employee": emp["name"],
        "direction": direction,
        "timestamp": now_str
    })


@app.route("/api/checkins", methods=["GET"])
def list_checkins():
    """
    Devuelve fichajes filtrados por fecha y/o empleado.
    Parámetros opcionales: ?date=YYYY-MM-DD  &employee_id=1
    """
    date_filter = request.args.get("date", "")
    emp_filter = request.args.get("employee_id", "")

    query = """
        SELECT c.id, e.name AS employee, c.direction, c.ts
        FROM checkins c
        JOIN employees e ON e.id = c.employee_id
        WHERE 1=1
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


# ─────────────────────────────────────────────
# RUTAS – FRONTEND
# ─────────────────────────────────────────────

@app.route("/")
def kiosk():
    return render_template("kiosk.html")


@app.route("/admin")
def admin():
    return render_template("admin.html")


# ─────────────────────────────────────────────
# ARRANQUE
# ─────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    print("Sistema de fichaje arrancado en http://localhost:5000")
    print("Panel admin en http://localhost:5000/admin")
    app.run(debug=True, host="0.0.0.0", port=5000)
