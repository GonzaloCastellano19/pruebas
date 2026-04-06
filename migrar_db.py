"""
migrar_db.py — Migra la base de datos antigua a la nueva estructura.
Ejecutar UNA sola vez: python migrar_db.py

La BD antigua (fichaje.db) se renombra a fichaje_backup.db
La nueva BD se crea desde cero con la estructura completa.
"""

import sqlite3
import os
import hashlib
import uuid
import shutil
from datetime import datetime

DB_VIEJO  = "fichaje.db"
DB_BACKUP = "fichaje_backup.db"

def hash_password(pwd):
    return hashlib.sha256(pwd.encode()).hexdigest()

def migrar():
    # 1. Backup de la BD antigua
    if os.path.exists(DB_VIEJO):
        shutil.copy2(DB_VIEJO, DB_BACKUP)
        print(f"✓ Backup creado: {DB_BACKUP}")

    # 2. Leer datos antiguos
    employees_viejos = []
    checkins_viejos  = []

    if os.path.exists(DB_VIEJO):
        old_conn = sqlite3.connect(DB_VIEJO)
        old_conn.row_factory = sqlite3.Row
        try:
            employees_viejos = old_conn.execute(
                "SELECT * FROM employees ORDER BY id"
            ).fetchall()
            checkins_viejos = old_conn.execute(
                "SELECT * FROM checkins ORDER BY id"
            ).fetchall()
            print(f"✓ Leídos {len(employees_viejos)} empleados y {len(checkins_viejos)} fichajes antiguos")
        except Exception as e:
            print(f"  No se pudieron leer datos antiguos: {e}")
        finally:
            old_conn.close()

    # 3. Borrar BD vieja y crear nueva
    if os.path.exists(DB_VIEJO):
        os.remove(DB_VIEJO)

    conn = sqlite3.connect(DB_VIEJO)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    # 4. Crear tablas nuevas
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS admins (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre     TEXT    NOT NULL,
            correo     TEXT    NOT NULL UNIQUE,
            password   TEXT    NOT NULL,
            telefono   TEXT,
            created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
            updated_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS empresas (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            admin_id   INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
            nombre     TEXT    NOT NULL,
            nif        TEXT,
            direccion  TEXT,
            sector     TEXT,
            created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS departamentos (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            empresa_id  INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            nombre      TEXT    NOT NULL,
            descripcion TEXT,
            created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
        );

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

        CREATE TABLE IF NOT EXISTS fichajes (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
            departamento_id INTEGER NOT NULL REFERENCES departamentos(id) ON DELETE CASCADE,
            empresa_id      INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
            entrada         TEXT    NOT NULL,
            salida          TEXT,
            tipo            TEXT    NOT NULL DEFAULT 'presencial',
            ubicacion       TEXT,
            estado          TEXT    NOT NULL DEFAULT 'abierto',
            created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
        );
    """)
    conn.commit()
    print("✓ Tablas nuevas creadas")

    # 5. Admin por defecto
    pwd_hash = hash_password("admin123")
    conn.execute(
        "INSERT INTO admins (nombre, correo, password) VALUES (?,?,?)",
        ("Administrador", "admin@admin.com", pwd_hash)
    )
    conn.commit()
    admin_id = conn.execute("SELECT id FROM admins WHERE correo='admin@admin.com'").fetchone()["id"]
    print(f"✓ Admin creado (id={admin_id})")

    # 6. Empresa y departamento por defecto para migrar empleados antiguos
    if employees_viejos:
        conn.execute(
            "INSERT INTO empresas (admin_id, nombre, sector) VALUES (?,?,?)",
            (admin_id, "Mi Empresa", "General")
        )
        conn.commit()
        empresa_id = conn.execute("SELECT id FROM empresas WHERE admin_id=?", (admin_id,)).fetchone()["id"]

        conn.execute(
            "INSERT INTO departamentos (empresa_id, nombre, descripcion) VALUES (?,?,?)",
            (empresa_id, "General", "Departamento por defecto para empleados migrados")
        )
        conn.commit()
        depto_id = conn.execute("SELECT id FROM departamentos WHERE empresa_id=?", (empresa_id,)).fetchone()["id"]
        print(f"✓ Empresa y departamento por defecto creados")

        # 7. Migrar empleados → usuarios
        emp_id_map = {}  # viejo_id -> nuevo_id
        for emp in employees_viejos:
            # El token viejo puede no tener el prefijo "usr_"
            token = emp["qr_token"] if emp["qr_token"].startswith("usr_") else "usr_" + emp["qr_token"]
            dni   = f"DNI-{emp['id']:05d}"  # DNI temporal
            try:
                cur = conn.execute("""
                    INSERT INTO usuarios
                    (empresa_id, departamento_id, dni, nombre, qr_token, rol)
                    VALUES (?,?,?,?,?,?)
                """, (empresa_id, depto_id, dni, emp["name"], token, "empleado"))
                emp_id_map[emp["id"]] = cur.lastrowid
            except sqlite3.IntegrityError as e:
                print(f"  ! Empleado '{emp['name']}' saltado: {e}")
        conn.commit()
        print(f"✓ {len(emp_id_map)} empleados migrados a usuarios")

        # 8. Migrar fichajes antiguos (IN/OUT → entrada/salida)
        # Agrupamos IN y OUT por empleado en pares
        fichajes_por_emp = {}
        for c in checkins_viejos:
            eid = c["employee_id"]
            if eid not in fichajes_por_emp:
                fichajes_por_emp[eid] = []
            fichajes_por_emp[eid].append(dict(c))

        fichajes_migrados = 0
        for old_emp_id, registros in fichajes_por_emp.items():
            if old_emp_id not in emp_id_map:
                continue
            nuevo_uid = emp_id_map[old_emp_id]
            registros_sorted = sorted(registros, key=lambda x: x["ts"])

            i = 0
            while i < len(registros_sorted):
                r = registros_sorted[i]
                if r["direction"] == "IN":
                    entrada = r["ts"]
                    salida  = None
                    estado  = "abierto"
                    # Buscar el OUT siguiente
                    if i + 1 < len(registros_sorted) and registros_sorted[i+1]["direction"] == "OUT":
                        salida = registros_sorted[i+1]["ts"]
                        estado = "cerrado"
                        i += 1
                    conn.execute("""
                        INSERT INTO fichajes
                        (usuario_id, departamento_id, empresa_id, entrada, salida, estado)
                        VALUES (?,?,?,?,?,?)
                    """, (nuevo_uid, depto_id, empresa_id, entrada, salida, estado))
                    fichajes_migrados += 1
                i += 1

        conn.commit()
        print(f"✓ {fichajes_migrados} fichajes migrados")

    conn.close()
    print("\n✅ Migración completada.")
    print(f"   Credenciales: admin@admin.com / admin123")
    print(f"   Backup en: {DB_BACKUP}")
    print(f"   Actualiza los DNIs de los empleados migrados en el panel admin.\n")


if __name__ == "__main__":
    migrar()
