import psycopg2
from psycopg2.extras import execute_values
import pandas as pd
from datetime import datetime, timedelta
import os
import json
import re
import bcrypt
import crypto
import warnings

# Suprimir advertencias de Pandas al usar psycopg2 directo
warnings.filterwarnings("ignore", category=UserWarning, module="pandas")
warnings.filterwarnings("ignore", message="pandas only supports SQLAlchemy.*")

DATABASE_URL = os.getenv("DATABASE_URL")

MAX_INTENTOS   = 5        # Intentos fallidos antes de bloquear
TIEMPO_BLOQUEO = 15      # Minutos de bloqueo

def get_connection():
    db_url = os.getenv("DATABASE_URL") or DATABASE_URL
    if not db_url:
        raise ValueError("Falta DATABASE_URL en las variables de entorno")
    conn = psycopg2.connect(db_url)
    return conn

def init_db():
    conn = get_connection()
    c = conn.cursor()

    # Usuarios
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password TEXT,
        role TEXT,
        gemini_key TEXT,
        tavily_key TEXT,
        email_user TEXT,
        email_pass_enc TEXT
    )''')

    # Historial de anÃ¡lisis
    c.execute('''CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value_enc TEXT,
        updated_at TEXT,
        updated_by TEXT
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS history (
        id SERIAL PRIMARY KEY,
        username TEXT,
        licitacion TEXT,
        fecha TEXT,
        items INTEGER
    )''')

    # Bandeja inteligente de correos
    c.execute('''CREATE TABLE IF NOT EXISTS smart_inbox (
        id SERIAL PRIMARY KEY,
        licitacion TEXT,
        remitente TEXT,
        asunto TEXT,
        fecha TEXT,
        resumen TEXT,
        renglones_relacionados TEXT,
        cuerpo TEXT,
        borrador_respuesta TEXT
    )''')

    # Cache de fichas tÃ©cnicas (ahorra tokens Gemini)
    c.execute('''CREATE TABLE IF NOT EXISTS fichas_cache (
        id SERIAL PRIMARY KEY,
        username TEXT,
        licitacion TEXT,
        codigo_renglon TEXT,
        datasheet_md TEXT,
        fecha TEXT,
        UNIQUE(username, licitacion, codigo_renglon)
    )''')

    # Tabla de cotizaciones extraÃ­das de correos (para uso futuro)
    c.execute('''CREATE TABLE IF NOT EXISTS cotizaciones (
        id SERIAL PRIMARY KEY,
        licitacion TEXT,
        renglon TEXT,
        proveedor TEXT,
        precio_unitario REAL,
        moneda TEXT,
        tiempo_entrega TEXT,
        condiciones TEXT,
        fecha TEXT,
        email_asunto TEXT
    )''')

    # === MÃšLTIPLES WORKSPACES POR USUARIO ===
    c.execute('''CREATE TABLE IF NOT EXISTS workspaces (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        licitacion TEXT NOT NULL,
        data_json TEXT,
        cg_json TEXT,
        fecha_guardado TEXT,
        UNIQUE(username, licitacion)
    )''')

    # app_state legacy (se mantiene para compatibilidad)
    c.execute('''CREATE TABLE IF NOT EXISTS app_state (
        username TEXT PRIMARY KEY,
        last_licitacion TEXT,
        last_data TEXT,
        last_cg TEXT
    )''')

    # === MONITOR DE LICITACIONES ACP ===
    c.execute('''CREATE TABLE IF NOT EXISTS seguimiento_licitaciones (
        id SERIAL PRIMARY KEY,
        numero_licitacion TEXT UNIQUE NOT NULL,
        owner_username TEXT,
        objeto TEXT,
        fecha_asignacion TEXT,
        fecha_envio_oferta TEXT,
        monto_ofertado REAL,
        moneda TEXT DEFAULT 'USD',
        estado TEXT DEFAULT 'En Preparacion',
        link_sli TEXT,
        notas TEXT,
        responsable TEXT,
        fecha_registro TEXT
    )''')
    c.execute("ALTER TABLE seguimiento_licitaciones ADD COLUMN IF NOT EXISTS owner_username TEXT")
    c.execute("ALTER TABLE seguimiento_licitaciones ADD COLUMN IF NOT EXISTS sli_snapshot_json TEXT")
    c.execute("ALTER TABLE seguimiento_licitaciones ADD COLUMN IF NOT EXISTS sli_checked_at TEXT")
    c.execute("""
        UPDATE seguimiento_licitaciones
        SET owner_username = COALESCE(NULLIF(owner_username, ''), NULLIF(responsable, ''), 'Sistema')
        WHERE owner_username IS NULL OR owner_username = ''
    """)
    c.execute("ALTER TABLE seguimiento_licitaciones DROP CONSTRAINT IF EXISTS seguimiento_licitaciones_numero_licitacion_key")
    c.execute("""
        DO $$
        DECLARE r RECORD;
        BEGIN
            FOR r IN
                SELECT indexname
                FROM pg_indexes
                WHERE schemaname = 'public'
                  AND tablename = 'seguimiento_licitaciones'
                  AND indexdef ILIKE 'CREATE UNIQUE INDEX%'
                  AND indexdef ILIKE '%(numero_licitacion)%'
                  AND indexdef NOT ILIKE '%owner_username%'
            LOOP
                EXECUTE format('DROP INDEX IF EXISTS %I', r.indexname);
            END LOOP;
        END $$;
    """)
    c.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_seguimiento_owner_numero
        ON seguimiento_licitaciones(owner_username, numero_licitacion)
    """)
    c.execute('''CREATE TABLE IF NOT EXISTS seguimiento_historial (
        id SERIAL PRIMARY KEY,
        licitacion_id INTEGER,
        fecha TEXT,
        estado_nuevo TEXT,
        nota TEXT,
        registrado_por TEXT,
        FOREIGN KEY(licitacion_id) REFERENCES seguimiento_licitaciones(id)
    )''')

    # ProtecciÃ³n contra fuerza bruta en login
    c.execute('''CREATE TABLE IF NOT EXISTS login_attempts (
        username TEXT PRIMARY KEY,
        intentos INTEGER DEFAULT 0,
        bloqueado_hasta TEXT
    )''')

    # --- Migrar workspace legacy a nueva tabla si existe ---
    c.execute("SELECT username, last_licitacion, last_data, last_cg FROM app_state")
    legacy_rows = c.fetchall()
    for row in legacy_rows:
        uname, lic, data, cg = row
        if lic and data and cg:
            c.execute("""INSERT INTO workspaces (username, licitacion, data_json, cg_json, fecha_guardado)
                         VALUES (%s, %s, %s, %s, %s) ON CONFLICT (username, licitacion) DO NOTHING""",
                      (uname, lic, data, cg, datetime.now().strftime("%Y-%m-%d %H:%M:%S")))

    # Usuario admin por defecto (contraseÃ±a: admin)
    c.execute("SELECT * FROM users WHERE username='admin'")
    if not c.fetchone():
        salt = bcrypt.gensalt()
        hashed_pw = bcrypt.hashpw(b"admin", salt).decode('utf-8')
        c.execute("INSERT INTO users VALUES ('admin', %s, 'Admin', '', '', '', '')", (hashed_pw,))
    c.execute("UPDATE users SET role='Admin' WHERE lower(username)='admin' AND role <> 'Admin'")


    # Metrics de consumo
    c.execute('''CREATE TABLE IF NOT EXISTS metrics_log (
        id SERIAL PRIMARY KEY,
        timestamp TEXT,
        username TEXT,
        action TEXT,
        tokens INTEGER
    )''')

    # Metricas operativas enriquecidas para Supabase/Postgres.
    # Mantiene detalle por usuario, modulo, funcion, licitacion y estado.
    c.execute('''CREATE TABLE IF NOT EXISTS usage_metrics (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        username TEXT,
        role TEXT,
        module TEXT NOT NULL,
        action TEXT NOT NULL,
        licitacion TEXT,
        provider TEXT,
        model TEXT,
        tokens_input INTEGER DEFAULT 0,
        tokens_output INTEGER DEFAULT 0,
        tokens_total INTEGER DEFAULT 0,
        estimated_cost_usd NUMERIC(12, 6) DEFAULT 0,
        status TEXT DEFAULT 'success',
        error_message TEXT,
        duration_ms INTEGER,
        metadata JSONB DEFAULT '{}'::jsonb
    )''')
    c.execute("CREATE INDEX IF NOT EXISTS idx_usage_metrics_created_at ON usage_metrics(created_at DESC)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_usage_metrics_user ON usage_metrics(username)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_usage_metrics_module_action ON usage_metrics(module, action)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_usage_metrics_licitacion ON usage_metrics(licitacion)")

    # Auditorias de proveedores/empresas. Guarda la memoria corporativa de riesgo.
    c.execute('''CREATE TABLE IF NOT EXISTS company_audits (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        username TEXT,
        company_name TEXT NOT NULL,
        normalized_company TEXT,
        website TEXT,
        domain TEXT,
        country TEXT,
        product_context TEXT,
        notes TEXT,
        score_final INTEGER DEFAULT 0,
        riesgo TEXT,
        decision TEXT,
        confianza TEXT,
        riesgo_tecnico TEXT,
        decision_tecnica TEXT,
        engine TEXT,
        evidence_count INTEGER DEFAULT 0,
        result_json JSONB DEFAULT '{}'::jsonb,
        technical_json JSONB DEFAULT '{}'::jsonb
    )''')
    c.execute("CREATE INDEX IF NOT EXISTS idx_company_audits_created ON company_audits(created_at DESC)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_company_audits_domain ON company_audits(domain)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_company_audits_company ON company_audits(normalized_company)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_company_audits_decision ON company_audits(decision)")

    # Historico de licitaciones importado desde el Excel corporativo.
    # Permite retirar el archivo fisico del repo y consultar precios/records desde Supabase.
    c.execute('''CREATE TABLE IF NOT EXISTS historico_licitaciones (
        id SERIAL PRIMARY KEY,
        numero_licitacion TEXT,
        mes TEXT,
        anio INTEGER,
        codigo_acp TEXT,
        codigo_match TEXT,
        cantidad NUMERIC(14, 2),
        precio_proyelec NUMERIC(14, 4),
        precio_competencia NUMERIC(14, 4),
        adjudicada_a_proyelec TEXT,
        analista_procura TEXT,
        observaciones TEXT,
        fuente TEXT DEFAULT 'excel_historico',
        imported_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(numero_licitacion, anio, codigo_acp, cantidad, precio_proyelec)
    )''')
    c.execute("CREATE INDEX IF NOT EXISTS idx_historico_codigo_match ON historico_licitaciones(codigo_match)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_historico_numero_anio ON historico_licitaciones(numero_licitacion, anio)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_historico_anio ON historico_licitaciones(anio)")

    # Tarifas por modelo/API. Mantener aqui permite ajustar costos sin tocar codigo.
    c.execute('''CREATE TABLE IF NOT EXISTS api_pricing (
        model TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        plan TEXT DEFAULT 'standard',
        currency TEXT DEFAULT 'USD',
        input_price_per_million NUMERIC(12, 6) DEFAULT 0,
        output_price_per_million NUMERIC(12, 6) DEFAULT 0,
        cache_price_per_million NUMERIC(12, 6) DEFAULT 0,
        search_price_per_1000 NUMERIC(12, 6) DEFAULT 0,
        source_url TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
    )''')
    c.execute("""INSERT INTO api_pricing
        (model, provider, plan, currency, input_price_per_million, output_price_per_million,
         cache_price_per_million, search_price_per_1000, source_url)
        VALUES
        ('gemini-2.5-flash', 'gemini', 'standard', 'USD', 0.30, 2.50, 0.03, 35.00, 'https://ai.google.dev/gemini-api/docs/pricing'),
        ('gemini-2.5-flash-lite', 'gemini', 'standard', 'USD', 0.10, 0.40, 0.01, 35.00, 'https://ai.google.dev/gemini-api/docs/pricing')
        ON CONFLICT (model) DO UPDATE SET
            provider = EXCLUDED.provider,
            plan = EXCLUDED.plan,
            currency = EXCLUDED.currency,
            input_price_per_million = EXCLUDED.input_price_per_million,
            output_price_per_million = EXCLUDED.output_price_per_million,
            cache_price_per_million = EXCLUDED.cache_price_per_million,
            search_price_per_1000 = EXCLUDED.search_price_per_1000,
            source_url = EXCLUDED.source_url,
            updated_at = NOW()
    """)

    # === RADAR DE LICITACIONES SLI ===
    c.execute('''CREATE TABLE IF NOT EXISTS radar_licitaciones (
        id SERIAL PRIMARY KEY,
        numero_licitacion TEXT UNIQUE NOT NULL,
        objeto TEXT,
        categoria TEXT,
        monto_estimado REAL DEFAULT 0,
        moneda TEXT DEFAULT 'USD',
        fecha_apertura TEXT,
        fecha_cierre TEXT,
        link_sli TEXT,
        es_prioritaria BOOLEAN DEFAULT FALSE,
        numero_enmienda TEXT DEFAULT '',
        fecha_descubierta TEXT,
        fecha_ultimo_escaneo TEXT,
        score_interes INTEGER DEFAULT 0,
        estado_radar TEXT DEFAULT 'nueva',
        revisada_por TEXT,
        notas TEXT
    )''')

    # Log de escaneos del radar
    c.execute('''CREATE TABLE IF NOT EXISTS radar_escaneos (
        id SERIAL PRIMARY KEY,
        fecha TEXT,
        total_encontradas INTEGER DEFAULT 0,
        nuevas INTEGER DEFAULT 0,
        errores TEXT
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS radar_document_analyses (
        radar_id INTEGER PRIMARY KEY,
        numero_licitacion TEXT NOT NULL,
        numero_enmienda TEXT DEFAULT '',
        document_fingerprint TEXT DEFAULT '',
        status TEXT DEFAULT 'completed',
        result_json JSONB DEFAULT '{}'::jsonb,
        error TEXT DEFAULT '',
        analyzed_at TIMESTAMPTZ DEFAULT NOW(),
        analyzed_by TEXT DEFAULT ''
    )''')
    c.execute("CREATE INDEX IF NOT EXISTS idx_radar_document_analyses_numero ON radar_document_analyses(numero_licitacion)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_radar_document_analyses_date ON radar_document_analyses(analyzed_at DESC)")
    c.execute("ALTER TABLE radar_licitaciones ADD COLUMN IF NOT EXISTS numero_enmienda TEXT DEFAULT ''")
    c.execute("ALTER TABLE radar_licitaciones ADD COLUMN IF NOT EXISTS enmienda_anterior TEXT DEFAULT ''")
    c.execute("ALTER TABLE radar_licitaciones ADD COLUMN IF NOT EXISTS enmienda_alerta BOOLEAN DEFAULT FALSE")
    c.execute("ALTER TABLE radar_licitaciones ADD COLUMN IF NOT EXISTS fecha_enmienda_alerta TEXT DEFAULT ''")
    for ddl in [
        "ALTER TABLE radar_escaneos ADD COLUMN IF NOT EXISTS paginas_recorridas INTEGER DEFAULT 0",
        "ALTER TABLE radar_escaneos ADD COLUMN IF NOT EXISTS total_detectadas_portal INTEGER DEFAULT 0",
        "ALTER TABLE radar_escaneos ADD COLUMN IF NOT EXISTS metodo TEXT DEFAULT ''",
        "ALTER TABLE radar_escaneos ADD COLUMN IF NOT EXISTS escaneo_completo BOOLEAN DEFAULT FALSE",
    ]:
        c.execute(ddl)

    # === MODULO LOGISTICO ===
    c.execute('''CREATE TABLE IF NOT EXISTS logistics_incoterms (
        sigla TEXT PRIMARY KEY,
        incoterm TEXT,
        responsabilidades JSONB DEFAULT '{}'::jsonb,
        notas TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS logistics_freight_rates (
        id SERIAL PRIMARY KEY,
        agente TEXT NOT NULL,
        tipo_servicio TEXT,
        tipo_flete TEXT NOT NULL,
        tarifa_por_libra NUMERIC(12, 4) DEFAULT 0,
        tiempo_transito_dias INTEGER DEFAULT 0,
        minimo_envio NUMERIC(12, 4) DEFAULT 0,
        dia_corte TEXT,
        salidas TEXT,
        activo BOOLEAN DEFAULT TRUE,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(agente, tipo_flete, tipo_servicio)
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS logistics_local_delivery_rates (
        id SERIAL PRIMARY KEY,
        agente TEXT NOT NULL,
        destino TEXT NOT NULL,
        tipo_flete TEXT DEFAULT 'Terrestre',
        hasta_400kg NUMERIC(12, 4) DEFAULT 0,
        kg_500_1000 NUMERIC(12, 4) DEFAULT 0,
        mayor_1000kg NUMERIC(12, 4) DEFAULT 0,
        activo BOOLEAN DEFAULT TRUE,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(agente, destino)
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS logistics_forwarders (
        id SERIAL PRIMARY KEY,
        nombre TEXT UNIQUE NOT NULL,
        direccion TEXT,
        observacion TEXT,
        activo BOOLEAN DEFAULT TRUE,
        updated_at TIMESTAMPTZ DEFAULT NOW()
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS logistics_calculations (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        username TEXT,
        licitacion TEXT,
        renglon TEXT,
        agente TEXT,
        tipo_flete TEXT,
        incoterm TEXT,
        peso_libras NUMERIC(14, 4) DEFAULT 0,
        peso_kg NUMERIC(14, 4) DEFAULT 0,
        costo_internacional NUMERIC(14, 4) DEFAULT 0,
        costo_local NUMERIC(14, 4) DEFAULT 0,
        costo_total NUMERIC(14, 4) DEFAULT 0,
        tiempo_transito_dias INTEGER DEFAULT 0,
        metadata JSONB DEFAULT '{}'::jsonb
    )''')
    for ddl in [
        "ALTER TABLE logistics_calculations ADD COLUMN IF NOT EXISTS peso_facturable_libras NUMERIC(14, 4) DEFAULT 0",
        "ALTER TABLE logistics_calculations ADD COLUMN IF NOT EXISTS peso_volumetrico_libras NUMERIC(14, 4) DEFAULT 0",
        "ALTER TABLE logistics_calculations ADD COLUMN IF NOT EXISTS largo NUMERIC(14, 4) DEFAULT 0",
        "ALTER TABLE logistics_calculations ADD COLUMN IF NOT EXISTS ancho NUMERIC(14, 4) DEFAULT 0",
        "ALTER TABLE logistics_calculations ADD COLUMN IF NOT EXISTS alto NUMERIC(14, 4) DEFAULT 0",
        "ALTER TABLE logistics_calculations ADD COLUMN IF NOT EXISTS unidad_dimensional TEXT DEFAULT 'in'",
    ]:
        c.execute(ddl)
    c.execute("CREATE INDEX IF NOT EXISTS idx_logistics_calculations_created ON logistics_calculations(created_at DESC)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_logistics_calculations_licitacion ON logistics_calculations(licitacion)")

    _seed_logistics_defaults(c)

    conn.commit()
    conn.close()

# =============================================
# WORKSPACES (MÃšLTIPLES POR USUARIO)
# =============================================

# =============================================
# HISTORICO CORPORATIVO DE LICITACIONES
# =============================================

def _clean_codigo_match(value):
    return "".join(ch for ch in str(value or "").upper() if ch.isascii() and ch.isalnum())

def _is_acp_code(value):
    """Identifica un codigo ACP completo para evitar busquedas textuales ambiguas."""
    return bool(re.fullmatch(r"[A-Z]{3}-[A-Z]{3}-\d{5}", str(value or "").strip().upper()))

def _clean_text(value):
    if pd.isna(value):
        return ""
    return str(value).strip()

def _to_float_or_none(value):
    if pd.isna(value) or value == "":
        return None
    try:
        return float(value)
    except Exception:
        cleaned = str(value).replace(",", "").replace("$", "").strip()
        try:
            return float(cleaned)
        except Exception:
            return None

def _to_int_or_none(value):
    if pd.isna(value) or value == "":
        return None
    try:
        return int(float(value))
    except Exception:
        return None

def normalize_historico_excel_df(df):
    df = df.rename(columns=lambda x: str(x).strip())
    rename_map = {
        "NÂ° DE LIC": "numero_licitacion",
        "NÃ‚Â° DE LIC": "numero_licitacion",
        "NÂº DE LIC": "numero_licitacion",
        "CODIGO ACP": "codigo_acp",
        "MES": "mes",
        "AÃ‘O": "anio",
        "AÃƒâ€˜O": "anio",
        "CANT": "cantidad",
        "PRECIO PROYELEC": "precio_proyelec",
        "PRECIO COMPETENCIA": "precio_competencia",
        "ADJUDICADA A PROYELEC": "adjudicada_a_proyelec",
        "ANALISTA DE PROCURA": "analista_procura",
        "OBSERVACIONES": "observaciones",
    }
    df = df.rename(columns={k: v for k, v in rename_map.items() if k in df.columns})
    expected = [
        "numero_licitacion", "mes", "anio", "codigo_acp", "cantidad",
        "precio_proyelec", "precio_competencia", "adjudicada_a_proyelec",
        "analista_procura", "observaciones",
    ]
    for col in expected:
        if col not in df.columns:
            df[col] = None

    out = df[expected].copy()
    out = out.dropna(how="all", subset=["numero_licitacion", "codigo_acp", "precio_proyelec", "precio_competencia"])
    out["numero_licitacion"] = out["numero_licitacion"].apply(lambda v: _clean_text(v).replace(".0", ""))
    out["mes"] = out["mes"].apply(_clean_text)
    out["codigo_acp"] = out["codigo_acp"].apply(_clean_text)
    out["codigo_match"] = out["codigo_acp"].apply(_clean_codigo_match)
    out["anio"] = out["anio"].apply(_to_int_or_none)
    out["cantidad"] = out["cantidad"].apply(_to_float_or_none)
    out["precio_proyelec"] = out["precio_proyelec"].apply(_to_float_or_none)
    out["precio_competencia"] = out["precio_competencia"].apply(_to_float_or_none)
    out["adjudicada_a_proyelec"] = out["adjudicada_a_proyelec"].apply(_clean_text)
    out["analista_procura"] = out["analista_procura"].apply(_clean_text)
    out["observaciones"] = out["observaciones"].apply(_clean_text)
    out = out[out["codigo_match"] != ""]
    out = out.drop_duplicates(
        subset=["numero_licitacion", "anio", "codigo_acp", "cantidad", "precio_proyelec"],
        keep="last",
    )
    return out

def import_historico_excel_to_db(excel_path="ACP DATA LIC PASADAS v2_2.xlsx", replace=False):
    df = pd.read_excel(excel_path, skiprows=8)
    df = normalize_historico_excel_df(df)
    conn = get_connection()
    c = conn.cursor()
    if replace:
        c.execute("DELETE FROM historico_licitaciones")
    values = [
        (
            row.get("numero_licitacion"), row.get("mes"), row.get("anio"),
            row.get("codigo_acp"), row.get("codigo_match"), row.get("cantidad"),
            row.get("precio_proyelec"), row.get("precio_competencia"),
            row.get("adjudicada_a_proyelec"), row.get("analista_procura"),
            row.get("observaciones"),
        )
        for row in df.to_dict("records")
    ]
    execute_values(c, """
        INSERT INTO historico_licitaciones
            (numero_licitacion, mes, anio, codigo_acp, codigo_match, cantidad,
             precio_proyelec, precio_competencia, adjudicada_a_proyelec,
             analista_procura, observaciones)
        VALUES %s
        ON CONFLICT (numero_licitacion, anio, codigo_acp, cantidad, precio_proyelec)
        DO UPDATE SET
            mes = EXCLUDED.mes,
            codigo_match = EXCLUDED.codigo_match,
            precio_competencia = EXCLUDED.precio_competencia,
            adjudicada_a_proyelec = EXCLUDED.adjudicada_a_proyelec,
            analista_procura = EXCLUDED.analista_procura,
            observaciones = EXCLUDED.observaciones,
            imported_at = NOW()
    """, values, page_size=1000)
    conn.commit()
    conn.close()
    return {"rows_source": int(len(df)), "rows_processed": int(len(df)), "replace": bool(replace)}

def _historico_filter_sql(search=None, searches=None, anio=None):
    params = []
    filters = []
    terms = searches if isinstance(searches, (list, tuple)) else []
    if not terms and search:
        terms = [search]
    terms = list(dict.fromkeys(str(term or "").strip() for term in terms if str(term or "").strip()))[:12]
    if terms:
        term_filters = []
        for term in terms:
            if _is_acp_code(term):
                term_filters.append("codigo_match = %s")
                params.append(_clean_codigo_match(term))
                continue
            q = f"%{term}%"
            term_filters.append("(numero_licitacion ILIKE %s OR codigo_acp ILIKE %s OR observaciones ILIKE %s OR analista_procura ILIKE %s OR mes ILIKE %s OR CAST(anio AS TEXT) ILIKE %s)")
            params.extend([q, q, q, q, q, q])
        filters.append("(" + " OR ".join(term_filters) + ")")
    if anio and str(anio) != "Todos":
        filters.append("anio = %s")
        params.append(int(anio))
    return (("WHERE " + " AND ".join(filters)) if filters else ""), params

def get_historico_licitaciones_df(limit=5000, search=None, searches=None, anio=None):
    conn = get_connection()
    where_clause, params = _historico_filter_sql(search=search, searches=searches, anio=anio)
    params.append(int(limit))
    df = pd.read_sql_query(f"""
        SELECT numero_licitacion AS "N° Licitación",
               anio AS "Año",
               mes AS "Mes",
               codigo_acp AS "Código ACP",
               cantidad AS "Cantidad",
               precio_proyelec AS "Precio Proyelec",
               precio_competencia AS "Precio Competencia",
               adjudicada_a_proyelec AS "Adjudicada a Proyelec",
               analista_procura AS "Analista",
               observaciones AS "Observaciones"
        FROM historico_licitaciones
        {where_clause}
        ORDER BY anio DESC NULLS LAST, numero_licitacion DESC NULLS LAST
        LIMIT %s
    """, conn, params=tuple(params))
    conn.close()
    return df


# =============================================
# AUDITORIA DE EMPRESAS / PROVEEDORES
# =============================================

def _normalize_company_key(value):
    text = re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()
    legal_terms = {
        "inc", "llc", "ltd", "corp", "corporation", "company", "co", "sa", "s", "de", "rl",
        "limited", "gmbh", "ag", "spa", "bv", "plc", "international", "group"
    }
    tokens = [token for token in text.split() if token and token not in legal_terms]
    return " ".join(tokens)[:220]

def save_company_audit(username="", company_name="", website="", domain="", country="",
                       product_context="", notes="", result=None, technical=None):
    result = result or {}
    technical = technical or {}
    normalized = _normalize_company_key(company_name or result.get("empresa"))
    score = result.get("score_final") or (technical.get("scorecard") or {}).get("score") or 0
    try:
        score = int(float(score))
    except Exception:
        score = 0
    conn = get_connection()
    try:
        c = conn.cursor()
        c.execute("""INSERT INTO company_audits
            (username, company_name, normalized_company, website, domain, country,
             product_context, notes, score_final, riesgo, decision, confianza,
             riesgo_tecnico, decision_tecnica, engine, evidence_count, result_json, technical_json)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb)
            RETURNING id""", (
                username,
                company_name or result.get("empresa", ""),
                normalized,
                website or result.get("website", ""),
                domain or technical.get("domain", ""),
                country or result.get("pais_region", ""),
                product_context or "",
                notes or "",
                score,
                result.get("riesgo", ""),
                result.get("decision", ""),
                result.get("confianza", ""),
                result.get("riesgo_tecnico", ""),
                result.get("decision_tecnica", ""),
                result.get("engine", ""),
                int(result.get("evidence_count") or 0),
                json.dumps(result, ensure_ascii=False),
                json.dumps(technical, ensure_ascii=False),
            ))
        audit_id = c.fetchone()[0]
        conn.commit()
        return audit_id
    finally:
        conn.close()

def get_company_audits(search="", limit=100):
    conn = get_connection()
    params = []
    where = ""
    if search:
        q = f"%{str(search).strip()}%"
        where = """WHERE company_name ILIKE %s
                   OR website ILIKE %s
                   OR domain ILIKE %s
                   OR country ILIKE %s
                   OR decision ILIKE %s
                   OR riesgo ILIKE %s"""
        params = [q, q, q, q, q, q]
    params.append(int(limit))
    try:
        return pd.read_sql_query(f"""
            SELECT id, created_at, username, company_name, website, domain, country,
                   score_final, riesgo, decision, confianza, riesgo_tecnico,
                   decision_tecnica, engine, evidence_count
            FROM company_audits
            {where}
            ORDER BY created_at DESC
            LIMIT %s
        """, conn, params=tuple(params))
    finally:
        conn.close()

def get_latest_company_audit(company_name="", domain=""):
    conn = get_connection()
    normalized = _normalize_company_key(company_name)
    try:
        c = conn.cursor()
        if domain:
            c.execute("""SELECT id, created_at, username, company_name, website, domain, country,
                                score_final, riesgo, decision, confianza, result_json, technical_json
                         FROM company_audits
                         WHERE domain=%s
                         ORDER BY created_at DESC LIMIT 1""", (domain,))
        elif normalized:
            c.execute("""SELECT id, created_at, username, company_name, website, domain, country,
                                score_final, riesgo, decision, confianza, result_json, technical_json
                         FROM company_audits
                         WHERE normalized_company=%s
                         ORDER BY created_at DESC LIMIT 1""", (normalized,))
        else:
            return None
        row = c.fetchone()
        if not row:
            return None
        cols = ["id", "created_at", "username", "company_name", "website", "domain", "country",
                "score_final", "riesgo", "decision", "confianza", "result_json", "technical_json"]
        return dict(zip(cols, row))
    finally:
        conn.close()

def _history_keywords(text):
    stop = {
        "para", "por", "con", "del", "los", "las", "una", "uno", "the", "and", "de", "la", "el",
        "suministro", "servicio", "adquisicion", "adquisiciÃ³n", "compra", "materiales", "repuestos"
    }
    words = []
    for raw in str(text or "").lower().replace("/", " ").replace("-", " ").split():
        word = "".join(ch for ch in raw if ch.isalnum())
        if len(word) >= 4 and word not in stop:
            words.append(word)
    return list(dict.fromkeys(words))[:8]

def _radar_supervisor_recommendation(total=0, ganadas=0, mejor_match=0, has_codes=False):
    if not has_codes:
        return {
            "decision": "Consultar RFQ/pliego",
            "accion": "Abrir detalle SLI/RFQ y validar renglones/codigos ACP antes de decidir.",
            "prioridad": "Alta",
            "tone": "warn",
            "motivo": "El listado del Radar no trae codigo ACP confiable. La comparacion historica es preliminar."
        }
    if mejor_match >= 75 and ganadas > 0:
        return {
            "decision": "Poner en seguimiento",
            "accion": "Revisar RFQ completo y buscar proveedor/precio usado anteriormente.",
            "prioridad": "Alta",
            "tone": "ok",
            "motivo": "Hay antecedente fuerte y participaciones/adjudicaciones previas."
        }
    if mejor_match >= 55 or total >= 2:
        return {
            "decision": "Revisar con analista",
            "accion": "Validar renglones, precio historico y disponibilidad de proveedores.",
            "prioridad": "Media",
            "tone": "info",
            "motivo": "Hay coincidencias historicas utiles, pero requieren validacion tecnica."
        }
    return {
        "decision": "Revision inicial",
        "accion": "Consultar RFQ y clasificar rubro antes de descartar o seguir.",
        "prioridad": "Media",
        "tone": "neutral",
        "motivo": "No hay historial fuerte por codigo o participacion anterior."
    }

def get_radar_document_analysis(radar_id):
    """Devuelve el ultimo analisis profundo y marca si una enmienda lo dejo obsoleto."""
    conn = get_connection()
    try:
        c = conn.cursor()
        c.execute(
            """
            SELECT r.numero_licitacion, COALESCE(r.numero_enmienda, ''),
                   a.numero_enmienda, a.document_fingerprint, a.status,
                   a.result_json, a.error, a.analyzed_at, a.analyzed_by
            FROM radar_licitaciones r
            LEFT JOIN radar_document_analyses a ON a.radar_id = r.id
            WHERE r.id = %s
            """,
            (int(radar_id),),
        )
        row = c.fetchone()
        if not row:
            return None

        numero, current_amendment, cached_amendment, fingerprint, status, result, error, analyzed_at, analyzed_by = row
        if cached_amendment is None:
            return {
                "available": False,
                "stale": False,
                "numero_licitacion": numero,
                "numero_enmienda_actual": current_amendment or "",
                "result": None,
            }

        if isinstance(result, str):
            try:
                result = json.loads(result)
            except (TypeError, ValueError):
                result = {}
        result = result if isinstance(result, dict) else {}
        return {
            "available": True,
            "stale": str(cached_amendment or "") != str(current_amendment or ""),
            "numero_licitacion": numero,
            "numero_enmienda_actual": current_amendment or "",
            "numero_enmienda_analizada": cached_amendment or "",
            "document_fingerprint": fingerprint or "",
            "status": status or "completed",
            "error": error or "",
            "analyzed_at": analyzed_at.isoformat() if hasattr(analyzed_at, "isoformat") else str(analyzed_at or ""),
            "analyzed_by": analyzed_by or "",
            "result": result,
        }
    finally:
        conn.close()

def save_radar_document_analysis(radar_id, result, analyzed_by=""):
    """Guarda un analisis verificable sin persistir los archivos RFQ descargados."""
    conn = get_connection()
    try:
        c = conn.cursor()
        c.execute(
            "SELECT numero_licitacion, COALESCE(numero_enmienda, '') FROM radar_licitaciones WHERE id=%s",
            (int(radar_id),),
        )
        radar = c.fetchone()
        if not radar:
            return False
        numero, amendment = radar
        payload = result if isinstance(result, dict) else {}
        c.execute(
            """
            INSERT INTO radar_document_analyses
                (radar_id, numero_licitacion, numero_enmienda, document_fingerprint,
                 status, result_json, error, analyzed_at, analyzed_by)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, NOW(), %s)
            ON CONFLICT (radar_id) DO UPDATE SET
                numero_licitacion = EXCLUDED.numero_licitacion,
                numero_enmienda = EXCLUDED.numero_enmienda,
                document_fingerprint = EXCLUDED.document_fingerprint,
                status = EXCLUDED.status,
                result_json = EXCLUDED.result_json,
                error = EXCLUDED.error,
                analyzed_at = NOW(),
                analyzed_by = EXCLUDED.analyzed_by
            """,
            (
                int(radar_id),
                str(numero or ""),
                str(amendment or ""),
                str(payload.get("document_fingerprint") or ""),
                str(payload.get("status") or ("completed" if payload.get("consultado") else "error")),
                json.dumps(payload, ensure_ascii=False, default=str),
                str(payload.get("error") or ""),
                str(analyzed_by or ""),
            ),
        )
        conn.commit()
        return True
    finally:
        conn.close()

def get_radar_historico_matches(radar_id, limit=12, sli_detail=None):
    conn = get_connection()
    try:
        c = conn.cursor()
        c.execute("SELECT numero_licitacion, objeto, categoria FROM radar_licitaciones WHERE id=%s", (int(radar_id),))
        radar = c.fetchone()
        if not radar:
            return None

        numero, objeto, categoria = radar
        sli_detail = sli_detail or {}
        sli_codes = sli_detail.get("codigos_acp_detectados") or []
        sli_items = sli_detail.get("renglones_detectados") or []
        sli_text_parts = [sli_detail.get("texto_visible") or ""]
        for item in sli_items if isinstance(sli_items, list) else []:
            if isinstance(item, dict):
                sli_text_parts.extend([
                    item.get("renglon") or "",
                    item.get("codigo_acp") or "",
                    item.get("codigo_articulo") or "",
                    item.get("descripcion") or "",
                    item.get("cantidad") or "",
                ])
            else:
                sli_text_parts.append(str(item))

        text_blob = " ".join([
            str(numero or ""),
            str(objeto or ""),
            str(categoria or ""),
            " ".join(str(code or "") for code in sli_codes),
            " ".join(str(part or "") for part in sli_text_parts),
        ])
        if sli_detail:
            strict_codes = [str(code or "").upper() for code in sli_codes]
            for item in sli_items if isinstance(sli_items, list) else []:
                if not isinstance(item, dict):
                    continue
                code = item.get("codigo_acp") or item.get("codigo_articulo")
                if code and str(item.get("estado_codigo") or "confirmado") == "confirmado":
                    strict_codes.append(str(code).upper())
            codigo_matches = [
                _clean_codigo_match(code)
                for code in strict_codes
                if re.fullmatch(r"[A-Z]{3}-[A-Z]{3}-\d{5}", code)
            ]
        else:
            codigo_matches = [
                _clean_codigo_match(match)
                for match in re.findall(r"\b[A-Z]{3}-[A-Z]{3}-\d{5}\b|\b[A-Z]{6}\d{5}\b", str(text_blob).upper())
            ]
        codigo_matches = [code for code in list(dict.fromkeys(codigo_matches)) if code][:12]
        keywords = _history_keywords(text_blob)
        sli_consultado = bool(sli_detail.get("consultado"))
        sli_error = sli_detail.get("error") or ""
        renglones_count = len(sli_items) if isinstance(sli_items, list) else 0
        pdfs_consultados = sli_detail.get("pdfs_consultados") or []
        documentos_consultados = sli_detail.get("documentos") or []
        requiere_ocr = bool(sli_detail.get("requiere_ocr"))
        analizado_en = sli_detail.get("analizado_en") or ""

        params = []
        filters = []
        if codigo_matches:
            filters.append("codigo_match = ANY(%s)")
            params.append(codigo_matches)
        else:
            if numero:
                filters.append("numero_licitacion = %s")
                params.append(str(numero))
            if keywords:
                keyword_filter = "(" + " OR ".join(["observaciones ILIKE %s OR codigo_acp ILIKE %s"] * len(keywords)) + ")"
                filters.append(keyword_filter)
                for kw in keywords:
                    params.extend([f"%{kw}%", f"%{kw}%"])

        empty_summary = {
            "total": 0,
            "ganadas": 0,
            "precio_min": None,
            "precio_promedio": None,
            "mejor_match": 0,
            "requiere_revision_rfq": not bool(codigo_matches),
            "sli_consultado": sli_consultado,
            "sli_error": sli_error,
            "renglones_detectados_count": renglones_count,
            "pdfs_consultados_count": len(pdfs_consultados) if isinstance(pdfs_consultados, list) else 0,
            "nota": (
                "No se detectaron codigos ACP en el listado ni en el detalle SLI. Hay que abrir/leer el RFQ o pliego adjunto para comparar por producto."
                if sli_consultado and not codigo_matches
                else "No se detectaron codigos ACP en el listado del Radar. La comparacion requiere consultar el detalle/RFQ."
            ),
            "recomendacion_supervisor": _radar_supervisor_recommendation(has_codes=False)
        }

        if not filters:
            return {
                "radar": {"numero_licitacion": numero, "objeto": objeto, "categoria": categoria},
                "keywords": [],
                "codigo_matches": [],
                "sli_detail": {
                    "consultado": sli_consultado,
                    "error": sli_error,
                    "renglones_detectados": sli_items[:12] if isinstance(sli_items, list) else [],
                    "pdfs_consultados": pdfs_consultados[:3] if isinstance(pdfs_consultados, list) else [],
                    "documentos": documentos_consultados[:8] if isinstance(documentos_consultados, list) else [],
                    "requiere_ocr": requiere_ocr,
                    "analizado_en": analizado_en,
                },
                "matches": [],
                "summary": empty_summary,
            }

        query = f"""
            SELECT numero_licitacion, mes, anio, codigo_acp, codigo_match, cantidad,
                   precio_proyelec, precio_competencia, adjudicada_a_proyelec,
                   analista_procura, observaciones
            FROM historico_licitaciones
            WHERE {" OR ".join(filters)}
            ORDER BY anio DESC NULLS LAST, imported_at DESC
            LIMIT %s
        """
        params.append(int(limit) * 4)
        df = pd.read_sql_query(query, conn, params=tuple(params))
        rows = []
        for row in df.to_dict("records") if not df.empty else []:
            score = 0
            reasons = []
            if numero and str(row.get("numero_licitacion") or "") == str(numero):
                score += 70
                reasons.append("Mismo numero de licitacion")
            if row.get("codigo_match") and row.get("codigo_match") in codigo_matches:
                score += 65 if sli_consultado else 55
                reasons.append("Codigo ACP coincidente desde detalle SLI/RFQ" if sli_consultado else "Codigo ACP coincidente")
            obs = str(row.get("observaciones") or "").lower()
            code_text = str(row.get("codigo_acp") or "").lower()
            matched_words = [kw for kw in keywords if kw in obs or kw in code_text]
            if matched_words:
                score += min(35, len(matched_words) * 9)
                reasons.append("Coincidencia por palabras: " + ", ".join(matched_words[:4]))
            if renglones_count and not row.get("codigo_match"):
                score += 5
                reasons.append("Detalle SLI trajo renglones para revision")
            if not reasons:
                reasons.append("Coincidencia amplia")
            row["match_score"] = min(100, score)
            row["match_reason"] = " | ".join(reasons)
            rows.append(row)

        rows = sorted(rows, key=lambda item: (item.get("match_score") or 0, item.get("anio") or 0), reverse=True)[: int(limit)]
        prices = [
            float(row.get("precio_proyelec"))
            for row in rows
            if row.get("precio_proyelec") is not None and str(row.get("precio_proyelec")) != "nan"
        ]
        ganadas = [
            row for row in rows
            if "si" in str(row.get("adjudicada_a_proyelec") or "").lower()
            or "proyelec" in str(row.get("adjudicada_a_proyelec") or "").lower()
            or "ep" == str(row.get("adjudicada_a_proyelec") or "").strip().lower()
        ]
        best_match = max([row.get("match_score") or 0 for row in rows], default=0)
        has_codes = bool(codigo_matches)
        if has_codes and sli_consultado:
            nota = "Comparacion enriquecida: se consulto el detalle SLI/RFQ visible, se detectaron codigos ACP y se cruzaron contra el historico."
        elif has_codes:
            nota = "Comparacion incluye codigo ACP detectado en el listado del Radar."
        elif sli_consultado and renglones_count:
            nota = "El detalle SLI trajo renglones, pero sin codigo ACP claro. La comparacion queda por palabras y requiere revisar el RFQ/pliego."
        else:
            nota = "Comparacion por palabras del objeto. Para mayor precision, consulta el RFQ y extrae codigos ACP/renglones."
        return {
            "radar": {"numero_licitacion": numero, "objeto": objeto, "categoria": categoria},
            "keywords": keywords,
            "codigo_matches": codigo_matches,
            "sli_detail": {
                "consultado": sli_consultado,
                "error": sli_error,
                "renglones_detectados": sli_items[:12] if isinstance(sli_items, list) else [],
                "pdfs_consultados": pdfs_consultados[:3] if isinstance(pdfs_consultados, list) else [],
                "documentos": documentos_consultados[:8] if isinstance(documentos_consultados, list) else [],
                "requiere_ocr": requiere_ocr,
                "analizado_en": analizado_en,
            },
            "matches": rows,
            "summary": {
                "total": len(rows),
                "ganadas": len(ganadas),
                "precio_min": min(prices) if prices else None,
                "precio_promedio": (sum(prices) / len(prices)) if prices else None,
                "mejor_match": best_match,
                "requiere_revision_rfq": not has_codes,
                "sli_consultado": sli_consultado,
                "sli_error": sli_error,
                "renglones_detectados_count": renglones_count,
                "pdfs_consultados_count": len(pdfs_consultados) if isinstance(pdfs_consultados, list) else 0,
                "nota": nota,
                "recomendacion_supervisor": _radar_supervisor_recommendation(
                    total=len(rows),
                    ganadas=len(ganadas),
                    mejor_match=best_match,
                    has_codes=has_codes,
                ),
            },
        }
    finally:
        conn.close()

# =============================================
# LOGISTICA
# =============================================

INCOTERM_STEPS = [
    "embalaje_verificacion",
    "carga_almacen",
    "transporte_interno_origen",
    "tramites_aduaneros_exportacion",
    "costo_terminal_origen",
    "transporte_principal",
    "seguro_transporte",
    "costo_terminal_destino",
    "tramites_aduaneros_importacion",
    "transporte_interior_destino",
    "descarga_almacen_comprador",
]

def _seed_logistics_defaults(c):
    incoterms = {
        "EXW": ("Ex Works", ["Vendedor", "Comprador", "Comprador", "Comprador", "Comprador", "Comprador", "Comprador", "Comprador", "Comprador", "Comprador", "Comprador"]),
        "FCA": ("Free Carrier", ["Vendedor", "Vendedor", "Vendedor", "Vendedor", "Comprador", "Comprador", "Comprador", "Comprador", "Comprador", "Comprador", "Comprador"]),
        "FAS": ("Free Alongside Ship", ["Vendedor", "Vendedor", "Vendedor", "Vendedor", "Comprador", "Comprador", "Comprador", "Comprador", "Comprador", "Comprador", "Comprador"]),
        "FOB": ("Free On Board", ["Vendedor", "Vendedor", "Vendedor", "Vendedor", "Vendedor", "Comprador", "Comprador", "Comprador", "Comprador", "Comprador", "Comprador"]),
        "CPT": ("Carriage Paid To", ["Vendedor", "Vendedor", "Vendedor", "Vendedor", "Vendedor", "Vendedor", "Comprador", "Comprador", "Comprador", "Comprador", "Comprador"]),
        "CFR": ("Cost and Freight", ["Vendedor", "Vendedor", "Vendedor", "Vendedor", "Vendedor", "Vendedor", "Comprador", "Comprador", "Comprador", "Comprador", "Comprador"]),
        "CIP": ("Carriage and Insurance Paid To", ["Vendedor", "Vendedor", "Vendedor", "Vendedor", "Vendedor", "Vendedor", "Vendedor", "Comprador", "Comprador", "Comprador", "Comprador"]),
        "CIF": ("Cost, Insurance and Freight", ["Vendedor", "Vendedor", "Vendedor", "Vendedor", "Vendedor", "Vendedor", "Vendedor", "Comprador", "Comprador", "Comprador", "Comprador"]),
        "DAP": ("Delivered at Place", ["Vendedor", "Vendedor", "Vendedor", "Vendedor", "Vendedor", "Vendedor", "Vendedor", "Vendedor", "Comprador", "Vendedor", "Comprador"]),
        "DPU": ("Delivered at Place Unloaded", ["Vendedor", "Vendedor", "Vendedor", "Vendedor", "Vendedor", "Vendedor", "Vendedor", "Vendedor", "Comprador", "Vendedor", "Vendedor"]),
    }
    for sigla, (nombre, valores) in incoterms.items():
        responsabilidades = dict(zip(INCOTERM_STEPS, valores))
        c.execute("""INSERT INTO logistics_incoterms (sigla, incoterm, responsabilidades, notas)
            VALUES (%s, %s, %s::jsonb, %s)
            ON CONFLICT (sigla) DO NOTHING""",
            (sigla, nombre, json.dumps(responsabilidades, ensure_ascii=False), ""))

    freight_rows = [
        ("Southcargo", "Door-To-Door", "Aereo", 3, 3, 10, "-", "Segun disponibilidad de la aerolinea"),
        ("ABMCARGO", "Door-To-Door", "Aereo", 50, 3, 35, "-", "Segun disponibilidad de la aerolinea"),
        ("Southcargo", "Door-To-Door", "Maritimo", 3, 6, 55, "Martes", "Semanales"),
        ("ABMCARGO", "Door-To-Door", "Maritimo", 50, 6, 90, "Martes", "Semanales"),
    ]
    for row in freight_rows:
        c.execute("""INSERT INTO logistics_freight_rates
            (agente, tipo_servicio, tipo_flete, tarifa_por_libra, tiempo_transito_dias, minimo_envio, dia_corte, salidas)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (agente, tipo_flete, tipo_servicio) DO NOTHING""", row)

    local_rows = [
        ("Ariel Nunez", "Corozal", "Terrestre", 50, 200, 230),
        ("Ariel Nunez", "Miraflores", "Terrestre", 50, 200, 230),
        ("Ariel Nunez", "Balboa", "Terrestre", 50, 200, 230),
        ("Ariel Nunez", "Gamboa", "Terrestre", 70, 200, 230),
        ("Ariel Nunez", "Colon", "Terrestre", 110, 200, 230),
        ("Ariel Nunez", "Atlantico Panama Pacifico", "Terrestre", 60, 200, 450),
    ]
    for row in local_rows:
        c.execute("""INSERT INTO logistics_local_delivery_rates
            (agente, destino, tipo_flete, hasta_400kg, kg_500_1000, mayor_1000kg)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (agente, destino) DO NOTHING""", row)

    forwarders = [
        ("SOUTH CARGO", "6708 NW 82ND AVE. MIAMI, FL. 33166", "Agente de envio / Centro de inspeccion."),
        ("ABM LOGISTICS", "9372 NW 101 ST MEDLEY, FL 33178 UNITED STATES", "Agente de envio / Centro de inspeccion."),
        ("MERCOSTAR", "8012 NW 68th Street Miami - FL 33166", "Centro de inspeccion."),
        ("ARIEL NUNEZ", "LAS CUMBRES CAIMITILLO CALLE SEGOVIA OESTE CASA 35J", "Entrega a cliente / Inspector."),
        ("DHL", "AV CENTENARIO, PANAMA CITY", "Agente de envio / Centro de inspeccion."),
    ]
    for row in forwarders:
        c.execute("""INSERT INTO logistics_forwarders (nombre, direccion, observacion)
            VALUES (%s, %s, %s)
            ON CONFLICT (nombre) DO NOTHING""", row)

def get_logistics_freight_rates():
    conn = get_connection()
    try:
        return pd.read_sql_query("SELECT * FROM logistics_freight_rates ORDER BY tipo_flete, agente", conn)
    finally:
        conn.close()

def get_logistics_local_rates():
    conn = get_connection()
    try:
        return pd.read_sql_query("SELECT * FROM logistics_local_delivery_rates ORDER BY agente, destino", conn)
    finally:
        conn.close()

def get_logistics_forwarders():
    conn = get_connection()
    try:
        return pd.read_sql_query("SELECT * FROM logistics_forwarders ORDER BY nombre", conn)
    finally:
        conn.close()

def get_logistics_incoterms():
    conn = get_connection()
    try:
        return pd.read_sql_query("SELECT sigla, incoterm, responsabilidades, notas FROM logistics_incoterms ORDER BY sigla", conn)
    finally:
        conn.close()

def upsert_logistics_freight_rate(agente, tipo_servicio, tipo_flete, tarifa_por_libra,
                                  tiempo_transito_dias, minimo_envio, dia_corte, salidas, activo=True):
    conn = get_connection()
    try:
        c = conn.cursor()
        c.execute("""INSERT INTO logistics_freight_rates
            (agente, tipo_servicio, tipo_flete, tarifa_por_libra, tiempo_transito_dias, minimo_envio, dia_corte, salidas, activo)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (agente, tipo_flete, tipo_servicio) DO UPDATE SET
                tarifa_por_libra=EXCLUDED.tarifa_por_libra,
                tiempo_transito_dias=EXCLUDED.tiempo_transito_dias,
                minimo_envio=EXCLUDED.minimo_envio,
                dia_corte=EXCLUDED.dia_corte,
                salidas=EXCLUDED.salidas,
                activo=EXCLUDED.activo,
                updated_at=NOW()""",
            (agente, tipo_servicio, tipo_flete, tarifa_por_libra, tiempo_transito_dias, minimo_envio, dia_corte, salidas, activo))
        conn.commit()
    finally:
        conn.close()

def upsert_logistics_local_rate(agente, destino, tipo_flete, hasta_400kg, kg_500_1000, mayor_1000kg, activo=True):
    conn = get_connection()
    try:
        c = conn.cursor()
        c.execute("""INSERT INTO logistics_local_delivery_rates
            (agente, destino, tipo_flete, hasta_400kg, kg_500_1000, mayor_1000kg, activo)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (agente, destino) DO UPDATE SET
                tipo_flete=EXCLUDED.tipo_flete,
                hasta_400kg=EXCLUDED.hasta_400kg,
                kg_500_1000=EXCLUDED.kg_500_1000,
                mayor_1000kg=EXCLUDED.mayor_1000kg,
                activo=EXCLUDED.activo,
                updated_at=NOW()""",
            (agente, destino, tipo_flete, hasta_400kg, kg_500_1000, mayor_1000kg, activo))
        conn.commit()
    finally:
        conn.close()

def upsert_logistics_forwarder(nombre, direccion, observacion, activo=True):
    conn = get_connection()
    try:
        c = conn.cursor()
        c.execute("""INSERT INTO logistics_forwarders (nombre, direccion, observacion, activo)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (nombre) DO UPDATE SET
                direccion=EXCLUDED.direccion,
                observacion=EXCLUDED.observacion,
                activo=EXCLUDED.activo,
                updated_at=NOW()""",
            (nombre, direccion, observacion, activo))
        conn.commit()
    finally:
        conn.close()

def save_logistics_calculation(username="", licitacion="", renglon="", agente="", tipo_flete="", incoterm="",
                                peso_libras=0, peso_kg=0, costo_internacional=0, costo_local=0,
                                costo_total=0, tiempo_transito_dias=0, metadata=None,
                                peso_facturable_libras=0, peso_volumetrico_libras=0,
                                largo=0, ancho=0, alto=0, unidad_dimensional="in"):
    metadata = metadata or {}
    conn = get_connection()
    try:
        c = conn.cursor()
        c.execute("""INSERT INTO logistics_calculations
             (username, licitacion, renglon, agente, tipo_flete, incoterm, peso_libras, peso_kg,
             costo_internacional, costo_local, costo_total, tiempo_transito_dias, metadata,
             peso_facturable_libras, peso_volumetrico_libras, largo, ancho, alto, unidad_dimensional)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s)""",
            (username, licitacion, renglon, agente, tipo_flete, incoterm, peso_libras, peso_kg,
             costo_internacional, costo_local, costo_total, tiempo_transito_dias,
             json.dumps(metadata, ensure_ascii=False), peso_facturable_libras, peso_volumetrico_libras,
             largo, ancho, alto, unidad_dimensional))
        conn.commit()
    finally:
        conn.close()

def get_logistics_calculations(limit=100):
    conn = get_connection()
    try:
        return pd.read_sql_query(
            f"SELECT * FROM logistics_calculations ORDER BY created_at DESC LIMIT {int(limit)}",
            conn
        )
    finally:
        conn.close()

def delete_logistics_calculation(calculation_id):
    conn = get_connection()
    try:
        c = conn.cursor()
        c.execute("DELETE FROM logistics_calculations WHERE id = %s", (int(calculation_id),))
        deleted = c.rowcount
        conn.commit()
        return deleted
    finally:
        conn.close()

def get_historico_anios():
    conn = get_connection()
    df = pd.read_sql_query("""
        SELECT DISTINCT anio
        FROM historico_licitaciones
        WHERE anio IS NOT NULL
        ORDER BY anio DESC
    """, conn)
    conn.close()
    return df["anio"].dropna().astype(int).tolist() if not df.empty else []

def get_historical_prices_df():
    conn = get_connection()
    df = pd.read_sql_query("""
        SELECT DISTINCT ON (codigo_match)
               codigo_match,
               precio_competencia AS "PRECIO COMPETENCIA",
               precio_proyelec AS "PRECIO PROYELEC",
               numero_licitacion AS licitacion_hist,
               anio AS anio_hist
        FROM historico_licitaciones
        WHERE codigo_match IS NOT NULL
          AND codigo_match <> ''
          AND (precio_competencia IS NOT NULL OR precio_proyelec IS NOT NULL)
        ORDER BY codigo_match,
                 anio DESC NULLS LAST,
                 imported_at DESC
    """, conn)
    conn.close()
    return df

def get_historico_count(search=None, searches=None, anio=None):
    conn = get_connection()
    c = conn.cursor()
    where_clause, params = _historico_filter_sql(search=search, searches=searches, anio=anio)
    c.execute(f"SELECT COUNT(*) FROM historico_licitaciones {where_clause}", tuple(params))
    count = c.fetchone()[0]
    conn.close()
    return int(count or 0)

def save_workspace(username, licitacion, data_json, cg_json):
    """Guarda o actualiza el workspace de una licitaciÃ³n especÃ­fica."""
    conn = get_connection()
    c = conn.cursor()
    fecha = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    c.execute("""INSERT INTO workspaces (username, licitacion, data_json, cg_json, fecha_guardado)
                 VALUES (%s, %s, %s, %s, %s)
                 ON CONFLICT (username, licitacion) DO UPDATE SET data_json = EXCLUDED.data_json, cg_json = EXCLUDED.cg_json, fecha_guardado = EXCLUDED.fecha_guardado""",
              (username, licitacion, data_json, cg_json, fecha))
    conn.commit()
    conn.close()

def get_all_workspaces(username, all_users=False):
    """Retorna todos los workspaces. Si all_users=True, retorna de todos los usuarios (para Gerencia)."""
    conn = get_connection()
    if all_users:
        df = pd.read_sql_query(
            """SELECT username, licitacion, fecha_guardado, data_json, cg_json FROM workspaces
               ORDER BY fecha_guardado DESC""", conn)
    else:
        df = pd.read_sql_query(
            """SELECT username, licitacion, fecha_guardado, data_json, cg_json FROM workspaces
               WHERE username=%s ORDER BY fecha_guardado DESC""",
            conn, params=(username,))
    conn.close()
    if df.empty:
        return df.drop(columns=["data_json", "cg_json"], errors="ignore")

    def workspace_summary(row):
        try:
            data = json.loads(row.get("data_json") or "[]")
            if not isinstance(data, list):
                data = []
        except Exception:
            data = []
        try:
            cg = json.loads(row.get("cg_json") or "{}")
            if not isinstance(cg, dict):
                cg = {}
        except Exception:
            cg = {}

        def first_value(keys, fallback=""):
            for key in keys:
                value = str(cg.get(key, "") or "").strip()
                if value and value.lower() not in {"nan", "none", "no especificado", "no especificado en los documentos adjuntos"}:
                    return value
            return fallback

        object_value = first_value(["objeto_licitacion", "objeto", "descripcion_licitacion", "titulo", "nombre_proyecto"])
        if not object_value:
            descriptions = []
            for item in data:
                if not isinstance(item, dict):
                    continue
                description = str(
                    item.get("termino_de_busqueda_corto")
                    or item.get("descripcion")
                    or item.get("ficha_tecnica_completa")
                    or ""
                ).strip().replace("\n", " ")
                if description and description not in descriptions:
                    descriptions.append(description)
            if descriptions:
                object_value = descriptions[0][:110]
                if len(data) > 1:
                    object_value = f"{object_value} + {len(data) - 1} renglones"

        return pd.Series({
            "renglones": len(data),
            "objeto": object_value,
            "entidad": first_value(["entidad_contratante", "entidad", "unidad_compras"], "ACP"),
            "fecha_cierre": first_value(["fecha_cierre", "fecha_hora_cierre", "cierre", "fecha_entrega_propuesta"]),
            "empresa_sugerida": first_value(["empresa_sugerida", "empresa_recomendada_participacion", "participar_con"]),
            "riesgo": first_value(["riesgo_tecnico_global", "riesgo_global"]),
        })

    summaries = df.apply(workspace_summary, axis=1)
    df = pd.concat([df.drop(columns=["data_json", "cg_json"]), summaries], axis=1)
    return df

def load_workspace(username, licitacion):
    """Carga un workspace especÃ­fico por licitaciÃ³n."""
    conn = get_connection()
    c = conn.cursor()
    c.execute("SELECT data_json, cg_json FROM workspaces WHERE username=%s AND licitacion=%s",
              (username, licitacion))
    row = c.fetchone()
    conn.close()
    return row  # (data_json, cg_json) o None

def delete_workspace(username, licitacion):
    """Elimina un workspace guardado."""
    conn = get_connection()
    c = conn.cursor()
    c.execute("DELETE FROM workspaces WHERE username=%s AND licitacion=%s", (username, licitacion))
    conn.commit()
    conn.close()

# Legacy â€” mantener compatibilidad con cÃ³digo existente
def save_workspace_state(username, licitacion, data_json, cg_json):
    save_workspace(username, licitacion, data_json, cg_json)

def load_workspace_state(username):
    """Carga el workspace mÃ¡s reciente del usuario (compatibilidad legacy)."""
    conn = get_connection()
    c = conn.cursor()
    c.execute("SELECT data_json, cg_json FROM workspaces WHERE username=%s ORDER BY fecha_guardado DESC LIMIT 1",
              (username,))
    row = c.fetchone()
    conn.close()
    return row

# =============================================
# GESTIÃ“N DE USUARIOS (ADMIN)
# =============================================

def get_all_users():
    """Retorna todos los usuarios del sistema para el panel de administraciÃ³n."""
    conn = get_connection()
    df = pd.read_sql_query(
        'SELECT username as "Usuario", role as "Nivel", email_user as "Correo", gemini_key as "Clave_Gemini", tavily_key as "Clave_Tavily" FROM users ORDER BY role, username', conn)
    conn.close()
    
    def mask_usable_secret(value):
        if not value:
            return "Sin configurar"
        decrypted = crypto.decrypt_data(value)
        if not decrypted:
            return "No usable - reconfigurar"
        return f"{decrypted[:6]}...{decrypted[-4:]}" if len(decrypted) > 12 else "Configurada"

    df['Clave_Gemini'] = df['Clave_Gemini'].apply(mask_usable_secret)
    df['Clave_Tavily'] = df['Clave_Tavily'].apply(mask_usable_secret)
    df['Correo'] = df['Correo'].apply(lambda x: x if x else "Sin configurar")
    
    return df

def create_user(username, password_plain, role):
    """Crea un nuevo usuario. Retorna True si exitoso, False si el username ya existe."""
    conn = get_connection()
    c = conn.cursor()
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password_plain.encode(), salt).decode('utf-8')
    try:
        c.execute("INSERT INTO users (username, password, role, gemini_key, tavily_key, email_user, email_pass_enc) VALUES (%s, %s, %s, '', '', '', '')",
                  (username, hashed, role))
        conn.commit()
        conn.close()
        return True
    except psycopg2.IntegrityError:
        conn.close()
        return False

def delete_user(username):
    """Elimina un usuario. No permite eliminar al admin principal."""
    if username == 'admin':
        return False
    conn = get_connection()
    c = conn.cursor()
    c.execute("DELETE FROM users WHERE username=%s", (username,))
    conn.commit()
    conn.close()
    return True

def update_user_role(username, new_role):
    """Cambia el rol de un usuario."""
    conn = get_connection()
    c = conn.cursor()
    c.execute("UPDATE users SET role=%s WHERE username=%s", (new_role, username))
    conn.commit()
    conn.close()

def reset_user_password(username, new_password_plain):
    """Resetea la contraseÃ±a de un usuario."""
    conn = get_connection()
    c = conn.cursor()
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(new_password_plain.encode(), salt).decode('utf-8')
    c.execute("UPDATE users SET password=%s WHERE username=%s", (hashed, username))
    conn.commit()
    conn.close()

# =============================================
# PROTECCIÃ“N CONTRA FUERZA BRUTA
# =============================================

def esta_bloqueado(username: str) -> tuple:
    """Retorna (bloqueado: bool, segundos_restantes: int)."""
    conn = get_connection()
    c = conn.cursor()
    c.execute("SELECT intentos, bloqueado_hasta FROM login_attempts WHERE username=%s", (username,))
    row = c.fetchone()
    conn.close()
    if not row or not row[1]:
        return False, 0
    hasta = datetime.fromisoformat(row[1])
    restante = (hasta - datetime.now()).total_seconds()
    if restante > 0:
        return True, int(restante)
    return False, 0

def registrar_intento_fallido(username: str):
    """Incrementa el contador de intentos fallidos; bloquea si supera el mÃ¡ximo."""
    conn = get_connection()
    c = conn.cursor()
    c.execute("INSERT INTO login_attempts (username, intentos) VALUES (%s, 0) ON CONFLICT (username) DO NOTHING", (username,))
    c.execute("UPDATE login_attempts SET intentos = intentos + 1 WHERE username=%s", (username,))
    c.execute("SELECT intentos FROM login_attempts WHERE username=%s", (username,))
    intentos = c.fetchone()[0]
    if intentos >= MAX_INTENTOS:
        hasta = (datetime.now() + timedelta(minutes=TIEMPO_BLOQUEO)).isoformat()
        c.execute("UPDATE login_attempts SET bloqueado_hasta=%s WHERE username=%s", (hasta, username))
    conn.commit()
    conn.close()

def resetear_intentos(username: str):
    """Limpia los intentos fallidos tras un login exitoso."""
    conn = get_connection()
    c = conn.cursor()
    c.execute("DELETE FROM login_attempts WHERE username=%s", (username,))
    conn.commit()
    conn.close()

# =============================================
# FUNCIONES DE USUARIOS
# =============================================

def get_user(username, password_plain):
    conn = get_connection()
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE LOWER(username)=LOWER(%s)", (username,))
    user = c.fetchone()
    conn.close()
    if user:
        stored_hash = user[1]
        try:
            if bcrypt.checkpw(password_plain.encode(), stored_hash.encode('utf-8')):
                # Descifrar gemini_key y tavily_key antes de devolver
                user = list(user)
                user[3] = crypto.decrypt_data(user[3]) if user[3] else ""
                user[4] = crypto.decrypt_data(user[4]) if user[4] else ""
                return tuple(user)
        except ValueError:
            pass
    return None

def update_user_profile(username, gemini, tavily, email, enc_pass):
    """Guarda el perfil del usuario. gemini y tavily se cifran aquÃ­ antes de guardar."""
    conn = get_connection()
    c = conn.cursor()
    enc_gemini = crypto.encrypt_data(gemini) if gemini else ""
    enc_tavily = crypto.encrypt_data(tavily) if tavily else ""
    c.execute("UPDATE users SET gemini_key=%s, tavily_key=%s, email_user=%s, email_pass_enc=%s WHERE username=%s",
              (enc_gemini, enc_tavily, email, enc_pass, username))
    conn.commit()
    conn.close()

def update_user_api_keys(username, gemini=None, tavily=None):
    """Actualiza llaves API de un usuario desde Admin sin tocar correo ni contrasena."""
    updates = []
    params = []
    if gemini is not None:
        updates.append("gemini_key=%s")
        params.append(crypto.encrypt_data(gemini) if gemini else "")
    if tavily is not None:
        updates.append("tavily_key=%s")
        params.append(crypto.encrypt_data(tavily) if tavily else "")
    if not updates:
        return False

    conn = get_connection()
    c = conn.cursor()
    params.append(username)
    c.execute(f"UPDATE users SET {', '.join(updates)} WHERE username=%s", tuple(params))
    changed = c.rowcount > 0
    conn.commit()
    conn.close()
    return changed

def set_system_setting(key, value, updated_by="Admin"):
    conn = get_connection()
    c = conn.cursor()
    value_enc = crypto.encrypt_data(value) if value else ""
    c.execute(
        """INSERT INTO system_settings (key, value_enc, updated_at, updated_by)
           VALUES (%s, %s, %s, %s)
           ON CONFLICT (key) DO UPDATE SET value_enc=EXCLUDED.value_enc, updated_at=EXCLUDED.updated_at, updated_by=EXCLUDED.updated_by""",
        (key, value_enc, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), updated_by),
    )
    conn.commit()
    conn.close()

def get_system_setting(key):
    conn = get_connection()
    c = conn.cursor()
    c.execute("SELECT value_enc, updated_at, updated_by FROM system_settings WHERE key=%s", (key,))
    row = c.fetchone()
    conn.close()
    if not row:
        return ("", "", "")
    value = crypto.decrypt_data(row[0]) if row[0] else ""
    return (value, row[1] or "", row[2] or "")

def get_system_setting_status(key):
    value, updated_at, updated_by = get_system_setting(key)
    masked = f"{value[:8]}...{value[-4:]}" if value and len(value) > 14 else ("Configurada" if value else "Sin configurar")
    return {
        "configured": bool(value),
        "masked": masked,
        "updated_at": updated_at,
        "updated_by": updated_by,
    }

def save_history(username, licitacion, items_count):
    conn = get_connection()
    c = conn.cursor()
    fecha_actual = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    c.execute("INSERT INTO history (username, licitacion, fecha, items) VALUES (%s, %s, %s, %s)",
              (username, licitacion, fecha_actual, items_count))
    conn.commit()
    conn.close()

def get_user_history_df(username):
    conn = get_connection()
    df = pd.read_sql_query(
        'SELECT licitacion as "NÂº LicitaciÃ³n", fecha as "Fecha Proceso", items as "Renglones" FROM history WHERE username=%s ORDER BY id DESC',
        conn, params=(username,))
    conn.close()
    return df

def delete_history_entry(username, licitacion):
    conn = get_connection()
    c = conn.cursor()
    c.execute("DELETE FROM history WHERE username=%s AND licitacion=%s", (username, licitacion))
    conn.commit()
    conn.close()

def clear_all_history(username):
    conn = get_connection()
    c = conn.cursor()
    c.execute("DELETE FROM history WHERE username=%s", (username,))
    conn.commit()
    conn.close()

def get_correos_licitacion_df(licitacion):
    conn = get_connection()
    try:
        df = pd.read_sql_query(
            "SELECT id, remitente, asunto, fecha, resumen, renglones_relacionados, cuerpo, borrador_respuesta FROM smart_inbox WHERE licitacion=%s ORDER BY id DESC",
            conn, params=(licitacion,))
    except Exception:
        df = pd.DataFrame()
    conn.close()
    return df

def get_user_credentials(username):
    conn = get_connection()
    c = conn.cursor()
    c.execute("SELECT email_user, email_pass_enc, gemini_key, tavily_key FROM users WHERE username=%s", (username,))
    row = c.fetchone()
    conn.close()
    if row:
        # Descifrar gemini_key (Ã­ndice 2) y tavily_key (Ã­ndice 3) antes de devolver
        return (row[0], row[1], crypto.decrypt_data(row[2]) if row[2] else "", crypto.decrypt_data(row[3]) if row[3] else "")
    return None

def check_email_exists(licitacion, asunto, remitente):
    conn = get_connection()
    c = conn.cursor()
    c.execute("SELECT id FROM smart_inbox WHERE licitacion=%s AND asunto=%s AND remitente=%s",
              (licitacion, asunto, remitente))
    exists = c.fetchone() is not None
    conn.close()
    return exists

def insert_smart_inbox(licitacion, remitente, asunto, fecha, resumen, renglones, cuerpo, borrador=""):
    conn = get_connection()
    c = conn.cursor()
    c.execute(
        "INSERT INTO smart_inbox (licitacion, remitente, asunto, fecha, resumen, renglones_relacionados, cuerpo, borrador_respuesta) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        (licitacion, remitente, asunto, fecha, resumen, renglones, cuerpo, borrador))
    conn.commit()
    conn.close()

def insert_cotizacion(licitacion, renglon, proveedor, precio_unitario, moneda, tiempo_entrega, condiciones, fecha, email_asunto):
    conn = get_connection()
    c = conn.cursor()
    c.execute(
        "INSERT INTO cotizaciones (licitacion, renglon, proveedor, precio_unitario, moneda, tiempo_entrega, condiciones, fecha, email_asunto) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (licitacion, renglon, proveedor, precio_unitario, moneda, tiempo_entrega, condiciones, fecha, email_asunto))
    conn.commit()
    conn.close()

def check_cotizacion_exists(licitacion, renglon, proveedor):
    conn = get_connection()
    c = conn.cursor()
    c.execute("SELECT id FROM cotizaciones WHERE licitacion=%s AND renglon=%s AND proveedor=%s",
              (licitacion, renglon, proveedor))
    exists = c.fetchone() is not None
    conn.close()
    return exists

def get_ficha_cache(username, licitacion, codigo_renglon):
    conn = get_connection()
    c = conn.cursor()
    c.execute("SELECT datasheet_md FROM fichas_cache WHERE username=%s AND licitacion=%s AND codigo_renglon=%s",
              (username, licitacion, codigo_renglon))
    row = c.fetchone()
    conn.close()
    return row[0] if row else None

def save_ficha_cache(username, licitacion, codigo_renglon, datasheet_md):
    conn = get_connection()
    c = conn.cursor()
    fecha = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    c.execute(
        "INSERT INTO fichas_cache (username, licitacion, codigo_renglon, datasheet_md, fecha) VALUES (%s, %s, %s, %s, %s) ON CONFLICT (username, licitacion, codigo_renglon) DO UPDATE SET datasheet_md = EXCLUDED.datasheet_md, fecha = EXCLUDED.fecha",
        (username, licitacion, codigo_renglon, datasheet_md, fecha))
    conn.commit()
    conn.close()

# =============================================
# MONITOR DE LICITACIONES ACP
# =============================================

ESTADOS_ACP = [
    "En Preparacion",
    "Oferta Enviada al SLI",
    "Cumple Tecnicamente",
    "No Cumple Tecnicamente",
    "En Evaluacion Economica",
    "Adjudicada",
    "No Adjudicada",
    "Desierta",
]

def crear_seguimiento(numero_licitacion, objeto, fecha_asignacion, fecha_envio_oferta,
                      monto_ofertado, moneda, link_sli, notas, responsable, owner_username=""):
    conn = get_connection()
    c = conn.cursor()
    fecha = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    owner_username = (owner_username or responsable or "Sistema").strip()
    responsable = (responsable or owner_username or "Sistema").strip()
    numero_licitacion = str(numero_licitacion or "").strip()

    try:
        c.execute("""
            INSERT INTO seguimiento_licitaciones
                (numero_licitacion, owner_username, objeto, fecha_asignacion, fecha_envio_oferta,
                 monto_ofertado, moneda, estado, link_sli, notas, responsable, fecha_registro)
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'En Preparacion', %s, %s, %s, %s)
            ON CONFLICT (owner_username, numero_licitacion) DO UPDATE SET
                objeto = COALESCE(NULLIF(EXCLUDED.objeto, ''), seguimiento_licitaciones.objeto),
                fecha_asignacion = COALESCE(NULLIF(EXCLUDED.fecha_asignacion, ''), seguimiento_licitaciones.fecha_asignacion),
                fecha_envio_oferta = COALESCE(NULLIF(EXCLUDED.fecha_envio_oferta, ''), seguimiento_licitaciones.fecha_envio_oferta),
                monto_ofertado = CASE WHEN EXCLUDED.monto_ofertado > 0 THEN EXCLUDED.monto_ofertado ELSE seguimiento_licitaciones.monto_ofertado END,
                moneda = COALESCE(NULLIF(EXCLUDED.moneda, ''), seguimiento_licitaciones.moneda),
                link_sli = COALESCE(NULLIF(EXCLUDED.link_sli, ''), seguimiento_licitaciones.link_sli),
                notas = CASE
                    WHEN EXCLUDED.notas IS NULL OR EXCLUDED.notas = '' THEN seguimiento_licitaciones.notas
                    WHEN seguimiento_licitaciones.notas IS NULL OR seguimiento_licitaciones.notas = '' THEN EXCLUDED.notas
                    WHEN seguimiento_licitaciones.notas LIKE '%%' || EXCLUDED.notas || '%%' THEN seguimiento_licitaciones.notas
                    ELSE seguimiento_licitaciones.notas || ' | ' || EXCLUDED.notas
                END,
                responsable = COALESCE(NULLIF(EXCLUDED.responsable, ''), seguimiento_licitaciones.responsable),
                owner_username = COALESCE(NULLIF(seguimiento_licitaciones.owner_username, ''), EXCLUDED.owner_username),
                fecha_registro = COALESCE(seguimiento_licitaciones.fecha_registro, EXCLUDED.fecha_registro)
            RETURNING *
        """, (numero_licitacion, owner_username, objeto, fecha_asignacion, fecha_envio_oferta,
              monto_ofertado or 0, moneda or "USD", link_sli, notas, responsable, fecha))
    except psycopg2.IntegrityError as exc:
        conn.rollback()
        print(f"[SEGUIMIENTO DB] Conflicto heredado para {numero_licitacion}, intentando recuperar registro: {exc}")
        c = conn.cursor()
        c.execute("""
            UPDATE seguimiento_licitaciones
            SET owner_username = COALESCE(NULLIF(owner_username, ''), %s),
                objeto = COALESCE(NULLIF(%s, ''), objeto),
                fecha_asignacion = COALESCE(NULLIF(%s, ''), fecha_asignacion),
                fecha_envio_oferta = COALESCE(NULLIF(%s, ''), fecha_envio_oferta),
                monto_ofertado = CASE WHEN %s > 0 THEN %s ELSE monto_ofertado END,
                moneda = COALESCE(NULLIF(%s, ''), moneda),
                link_sli = COALESCE(NULLIF(%s, ''), link_sli),
                notas = CASE
                    WHEN %s IS NULL OR %s = '' THEN notas
                    WHEN notas IS NULL OR notas = '' THEN %s
                    WHEN notas LIKE '%%' || %s || '%%' THEN notas
                    ELSE notas || ' | ' || %s
                END,
                responsable = COALESCE(NULLIF(%s, ''), responsable),
                fecha_registro = COALESCE(fecha_registro, %s)
            WHERE numero_licitacion = %s
            RETURNING *
        """, (owner_username, objeto, fecha_asignacion, fecha_envio_oferta,
              monto_ofertado or 0, monto_ofertado or 0, moneda or "USD", link_sli,
              notas, notas, notas, notas, notas, responsable, fecha, numero_licitacion))
    except Exception as exc:
        print(f"[SEGUIMIENTO DB] Error creando/actualizando {numero_licitacion}: {exc}")
        conn.close()
        return None

    row = c.fetchone()
    if not row:
        conn.close()
        return None

    columns = [desc[0] for desc in c.description]
    record = dict(zip(columns, row))
    licitacion_id = record.get("id")
    if licitacion_id:
        c.execute("""INSERT INTO seguimiento_historial (licitacion_id, fecha, estado_nuevo, nota, registrado_por)
                     VALUES (%s, %s, %s, %s, %s)""",
                  (licitacion_id, fecha, record.get("estado") or "En Preparacion", notas or "Agregado/actualizado en seguimiento", responsable or "Sistema"))
    conn.commit()
    conn.close()
    return record

def get_seguimientos(username="", role="Analista"):
    conn = get_connection()
    username = (username or "").strip()
    role = (role or "").strip()
    if role in ("Supervisor", "Gerencia"):
        df = pd.read_sql_query(
            "SELECT * FROM seguimiento_licitaciones ORDER BY fecha_registro DESC", conn)
    else:
        df = pd.read_sql_query(
            """SELECT * FROM seguimiento_licitaciones
               WHERE lower(COALESCE(owner_username, ''))=%s
                  OR lower(COALESCE(responsable, ''))=%s
               ORDER BY fecha_registro DESC""",
            conn,
            params=(username.lower(), username.lower()),
        )
    conn.close()
    return df

def actualizar_estado(licitacion_id, nuevo_estado, nota, registrado_por):
    conn = get_connection()
    c = conn.cursor()
    fecha = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    nota_limpia = (nota or "").strip()
    if nota_limpia:
        c.execute("""
            UPDATE seguimiento_licitaciones
            SET estado=%s,
                notas = CASE
                    WHEN notas IS NULL OR notas = '' THEN %s
                    WHEN notas LIKE %s THEN notas
                    ELSE notas || ' | ' || %s
                END
            WHERE id=%s
        """, (nuevo_estado, nota_limpia, f"%{nota_limpia}%", nota_limpia, licitacion_id))
    else:
        c.execute("UPDATE seguimiento_licitaciones SET estado=%s WHERE id=%s", (nuevo_estado, licitacion_id))
    c.execute("""INSERT INTO seguimiento_historial (licitacion_id, fecha, estado_nuevo, nota, registrado_por)
                 VALUES (%s, %s, %s, %s, %s)""", (licitacion_id, fecha, nuevo_estado, nota_limpia, registrado_por))
    conn.commit()
    conn.close()

def guardar_snapshot_sli(licitacion_id, snapshot):
    conn = get_connection()
    c = conn.cursor()
    checked_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    payload = json.dumps(snapshot or {}, ensure_ascii=False, default=str)
    c.execute(
        """UPDATE seguimiento_licitaciones
           SET sli_snapshot_json=%s, sli_checked_at=%s
           WHERE id=%s
           RETURNING id""",
        (payload, checked_at, licitacion_id),
    )
    row = c.fetchone()
    conn.commit()
    conn.close()
    return {"id": row[0], "sli_checked_at": checked_at} if row else None

def get_historial_seguimiento(licitacion_id):
    conn = get_connection()
    df = pd.read_sql_query(
        "SELECT fecha, estado_nuevo, nota, registrado_por FROM seguimiento_historial WHERE licitacion_id=%s ORDER BY id DESC",
        conn, params=(licitacion_id,))
    conn.close()
    return df

def eliminar_seguimiento(licitacion_id):
    conn = get_connection()
    c = conn.cursor()
    c.execute("DELETE FROM seguimiento_historial WHERE licitacion_id=%s", (licitacion_id,))
    c.execute("DELETE FROM seguimiento_licitaciones WHERE id=%s", (licitacion_id,))
    conn.commit()
    conn.close()



def get_api_pricing_df():
    conn = get_connection()
    df = pd.read_sql_query(
        """SELECT model, provider, plan, currency, input_price_per_million,
                  output_price_per_million, cache_price_per_million,
                  search_price_per_1000, source_url, updated_at
           FROM api_pricing ORDER BY provider, model""",
        conn
    )
    conn.close()
    return df

def get_api_pricing(model):
    if not model:
        return None
    conn = get_connection()
    c = conn.cursor()
    c.execute("""SELECT input_price_per_million, output_price_per_million,
                        cache_price_per_million, search_price_per_1000, currency, plan
                 FROM api_pricing WHERE model=%s""", (model,))
    row = c.fetchone()
    conn.close()
    return row

def calculate_api_cost(model, tokens_input=0, tokens_output=0, cache_tokens=0, search_requests=0):
    """Calcula costo billable estimado con tarifas guardadas en api_pricing."""
    pricing = get_api_pricing(model)
    if not pricing:
        return 0.0

    input_price, output_price, cache_price, search_price, _, _ = pricing
    tokens_input = int(tokens_input or 0)
    tokens_output = int(tokens_output or 0)
    cache_tokens = int(cache_tokens or 0)
    search_requests = int(search_requests or 0)

    cost = 0.0
    cost += (tokens_input / 1_000_000) * float(input_price or 0)
    cost += (tokens_output / 1_000_000) * float(output_price or 0)
    cost += (cache_tokens / 1_000_000) * float(cache_price or 0)
    cost += (search_requests / 1_000) * float(search_price or 0)
    return round(cost, 6)

def extract_usage_counts(usage_metadata):
    """Normaliza usage_metadata de Gemini a input/output/total tokens."""
    if not usage_metadata:
        return 0, 0, 0

    def read_attr(*names):
        for name in names:
            if isinstance(usage_metadata, dict) and name in usage_metadata:
                return usage_metadata.get(name) or 0
            if hasattr(usage_metadata, name):
                return getattr(usage_metadata, name) or 0
        return 0

    input_tokens = read_attr("prompt_token_count", "input_token_count")
    output_tokens = read_attr("candidates_token_count", "output_token_count")
    total_tokens = read_attr("total_token_count")
    if not total_tokens:
        total_tokens = int(input_tokens or 0) + int(output_tokens or 0)
    if not output_tokens and total_tokens and input_tokens:
        output_tokens = max(int(total_tokens) - int(input_tokens), 0)
    return int(input_tokens or 0), int(output_tokens or 0), int(total_tokens or 0)

def log_usage_event(username="", role="", module="general", action="", licitacion="",
                    provider="", model="", tokens_input=0, tokens_output=0,
                    tokens_total=0, estimated_cost_usd=None, status="success",
                    error_message="", duration_ms=None, metadata=None):
    """Registra un evento operativo. Nunca debe romper el flujo principal."""
    if metadata is None:
        metadata = {}
    tokens_input = int(tokens_input or 0)
    tokens_output = int(tokens_output or 0)
    tokens_total = int(tokens_total or 0)
    if not tokens_total:
        tokens_total = tokens_input + tokens_output
    if estimated_cost_usd is None:
        estimated_cost_usd = calculate_api_cost(
            model=model,
            tokens_input=tokens_input,
            tokens_output=tokens_output,
            cache_tokens=int(metadata.get("cache_tokens", 0) or 0) if isinstance(metadata, dict) else 0,
            search_requests=int(metadata.get("search_requests", 0) or 0) if isinstance(metadata, dict) else 0,
        )

    conn = None
    try:
        conn = get_connection()
        c = conn.cursor()
        c.execute("""INSERT INTO usage_metrics
            (username, role, module, action, licitacion, provider, model,
             tokens_input, tokens_output, tokens_total, estimated_cost_usd,
             status, error_message, duration_ms, metadata)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)""",
            (username or "", role or "", module or "general", action or "",
             licitacion or "", provider or "", model or "",
             tokens_input, tokens_output, tokens_total,
             estimated_cost_usd, status or "success", error_message or "",
             duration_ms, json.dumps(metadata, ensure_ascii=False)))
        conn.commit()
    except Exception as e:
        print(f"[METRICS] No se pudo registrar evento: {e}")
    finally:
        if conn:
            conn.close()

def log_metric(username, action, tokens):
    """Compatibilidad con llamadas existentes; tambien alimenta usage_metrics."""
    conn = None
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        conn = get_connection()
        c = conn.cursor()
        c.execute("INSERT INTO metrics_log (timestamp, username, action, tokens) VALUES (%s, %s, %s, %s)",
                  (now, username, action, int(tokens or 0)))
        conn.commit()
    except Exception as e:
        print(f"[METRICS_LOG] No se pudo registrar legacy metric: {e}")
    finally:
        if conn:
            conn.close()

    log_usage_event(
        username=username,
        module="ai",
        action=action,
        provider="gemini",
        model="gemini-2.5-flash",
        tokens_total=int(tokens or 0),
        metadata={"legacy_action": action, "cost_accuracy": "legacy_total_only"}
    )

def log_ai_usage(username="", role="", action="", licitacion="", model="gemini-2.5-flash",
                 usage_metadata=None, status="success", error_message="", duration_ms=None,
                 metadata=None):
    tokens_input, tokens_output, tokens_total = extract_usage_counts(usage_metadata)
    metadata = metadata or {}
    metadata.setdefault("cost_accuracy", "input_output_tokens")
    log_usage_event(
        username=username,
        role=role,
        module="ai",
        action=action,
        licitacion=licitacion,
        provider="gemini",
        model=model,
        tokens_input=tokens_input,
        tokens_output=tokens_output,
        tokens_total=tokens_total,
        status=status,
        error_message=error_message,
        duration_ms=duration_ms,
        metadata=metadata,
    )

def get_metrics_data():
    conn = get_connection()
    c = conn.cursor()
    c.execute("SELECT timestamp, username, action, tokens FROM metrics_log ORDER BY id DESC")
    rows = c.fetchall()
    conn.close()
    return rows

def get_usage_metrics_df(days=90, username=None, module=None):
    conn = get_connection()
    params = [int(days)]
    filters = ["created_at >= NOW() - (%s * INTERVAL '1 day')"]
    if username and username != "Todos":
        filters.append("username = %s")
        params.append(username)
    if module and module != "Todos":
        filters.append("module = %s")
        params.append(module)

    where_clause = " AND ".join(filters)
    df = pd.read_sql_query(f"""
        SELECT id, created_at, username, role, module, action, licitacion,
               provider, model, tokens_input, tokens_output, tokens_total,
               estimated_cost_usd, status, error_message, duration_ms
        FROM usage_metrics
        WHERE {where_clause}
        ORDER BY created_at DESC
    """, conn, params=tuple(params))
    conn.close()
    return df

def get_usage_filter_options(days=180):
    conn = get_connection()
    try:
        users_df = pd.read_sql_query(
            """SELECT DISTINCT username FROM usage_metrics
               WHERE created_at >= NOW() - (%s * INTERVAL '1 day')
                 AND COALESCE(username, '') <> ''
               ORDER BY username""",
            conn,
            params=(int(days),),
        )
        modules_df = pd.read_sql_query(
            """SELECT DISTINCT module FROM usage_metrics
               WHERE created_at >= NOW() - (%s * INTERVAL '1 day')
                 AND COALESCE(module, '') <> ''
               ORDER BY module""",
            conn,
            params=(int(days),),
        )
    finally:
        conn.close()
    users = users_df["username"].dropna().astype(str).tolist() if not users_df.empty else []
    modules = modules_df["module"].dropna().astype(str).tolist() if not modules_df.empty else []
    return {
        "users": ["Todos"] + users,
        "modules": ["Todos"] + modules,
    }

def get_usage_summary(days=30, username=None, module=None):
    df = get_usage_metrics_df(days, username=username, module=module)
    if df.empty:
        return {
            "total_events": 0,
            "active_users": 0,
            "active_licitaciones": 0,
            "tokens_total": 0,
            "estimated_cost_usd": 0.0,
            "errors": 0,
            "peak_users_hour": 0,
            "uncosted_events": 0,
            "df": df,
            "by_module": pd.DataFrame(),
            "by_user": pd.DataFrame(),
            "by_day": pd.DataFrame(),
            "by_month": pd.DataFrame(),
            "by_hour": pd.DataFrame(),
            "by_status": pd.DataFrame(),
            "recent_errors": pd.DataFrame(),
        }

    df["created_at"] = pd.to_datetime(df["created_at"], errors="coerce", utc=True).dt.tz_convert(None)
    df["estimated_cost_usd"] = pd.to_numeric(df["estimated_cost_usd"], errors="coerce").fillna(0)
    df["tokens_input"] = pd.to_numeric(df["tokens_input"], errors="coerce").fillna(0).astype(int)
    df["tokens_output"] = pd.to_numeric(df["tokens_output"], errors="coerce").fillna(0).astype(int)
    df["tokens_total"] = pd.to_numeric(df["tokens_total"], errors="coerce").fillna(0).astype(int)
    legacy_total_only = (
        (df["module"] == "ai")
        & (df["tokens_total"] > 0)
        & ((df["tokens_input"] + df["tokens_output"]) == 0)
    )
    df["cost_is_real"] = ~legacy_total_only
    df.loc[legacy_total_only, "estimated_cost_usd"] = 0
    by_module = df.groupby(["module", "action"], dropna=False).agg(
        eventos=("id", "count"),
        tokens_entrada=("tokens_input", "sum"),
        tokens_salida=("tokens_output", "sum"),
        tokens=("tokens_total", "sum"),
        costo_estimado=("estimated_cost_usd", "sum"),
        errores=("status", lambda s: (s != "success").sum())
    ).reset_index().sort_values(["tokens", "eventos"], ascending=False)
    by_user = df.groupby("username", dropna=False).agg(
        eventos=("id", "count"),
        tokens_entrada=("tokens_input", "sum"),
        tokens_salida=("tokens_output", "sum"),
        tokens=("tokens_total", "sum"),
        costo_estimado=("estimated_cost_usd", "sum")
    ).reset_index().sort_values(["tokens", "eventos"], ascending=False)
    by_day = df.assign(day=df["created_at"].dt.date).groupby("day").agg(
        eventos=("id", "count"),
        tokens_entrada=("tokens_input", "sum"),
        tokens_salida=("tokens_output", "sum"),
        tokens=("tokens_total", "sum"),
        costo_estimado=("estimated_cost_usd", "sum")
    ).reset_index()
    by_month = df.assign(month=df["created_at"].dt.to_period("M").astype(str)).groupby("month").agg(
        eventos=("id", "count"),
        usuarios=("username", lambda s: s.replace("", pd.NA).dropna().nunique()),
        tokens_entrada=("tokens_input", "sum"),
        tokens_salida=("tokens_output", "sum"),
        tokens=("tokens_total", "sum"),
        costo_estimado=("estimated_cost_usd", "sum"),
        errores=("status", lambda s: (s != "success").sum())
    ).reset_index()
    by_hour = df.assign(hour=df["created_at"].dt.floor("h")).groupby("hour").agg(
        eventos=("id", "count"),
        usuarios=("username", lambda s: s.replace("", pd.NA).dropna().nunique())
    ).reset_index()
    by_status = df.groupby("status", dropna=False).agg(eventos=("id", "count")).reset_index()
    recent_errors = df[df["status"] != "success"].copy()
    if not recent_errors.empty:
        recent_errors = recent_errors[[
            "created_at", "username", "module", "action", "provider",
            "model", "licitacion", "error_message", "duration_ms"
        ]].head(12)

    return {
        "total_events": int(len(df)),
        "active_users": int(df["username"].replace("", pd.NA).dropna().nunique()),
        "active_licitaciones": int(df["licitacion"].replace("", pd.NA).dropna().nunique()),
        "tokens_total": int(df["tokens_total"].fillna(0).sum()),
        "estimated_cost_usd": float(df["estimated_cost_usd"].fillna(0).sum()),
        "errors": int((df["status"] != "success").sum()),
        "peak_users_hour": int(by_hour["usuarios"].max()) if not by_hour.empty else 0,
        "uncosted_events": int(legacy_total_only.sum()),
        "df": df,
        "by_module": by_module,
        "by_user": by_user,
        "by_day": by_day,
        "by_month": by_month,
        "by_hour": by_hour,
        "by_status": by_status,
        "recent_errors": recent_errors,
    }

def log_login_attempt(username, is_success):
    log_usage_event(
        username=username,
        module="auth",
        action="login",
        status="success" if is_success else "error",
        error_message="" if is_success else "Credenciales incorrectas"
    )

# =============================================
# RADAR DE LICITACIONES SLI
# =============================================

def _calcular_score_radar(monto_estimado, es_prioritaria):
    score = 1
    monto_estimado = float(monto_estimado or 0)
    if monto_estimado > 1000000:
        score = 10
    elif monto_estimado > 500000:
        score = 8
    elif monto_estimado > 100000:
        score = 6
    elif monto_estimado > 50000:
        score = 4
    elif monto_estimado > 10000:
        score = 2
    if es_prioritaria:
        score = min(score + 2, 10)
    return score

def _normalizar_enmienda_radar(value):
    text = str(value or "").strip()
    if text.lower() in ["0", "no", "n/a", "na", "none", "null"]:
        return ""
    return text

def _registrar_alerta_enmienda_si_aplica(cursor, numero_licitacion, enmienda_nueva, fecha):
    enmienda_nueva = _normalizar_enmienda_radar(enmienda_nueva)
    cursor.execute("""
        SELECT numero_enmienda, estado_radar
        FROM radar_licitaciones
        WHERE numero_licitacion=%s
    """, (numero_licitacion,))
    row = cursor.fetchone()
    if not row:
        return False
    enmienda_actual = _normalizar_enmienda_radar(row[0])
    estado = str(row[1] or "")
    if estado not in ("descartada", "en_seguimiento"):
        return False
    if not enmienda_nueva or enmienda_nueva == enmienda_actual:
        return False
    cursor.execute("""
        UPDATE radar_licitaciones
        SET enmienda_anterior=%s,
            enmienda_alerta=TRUE,
            fecha_enmienda_alerta=%s
        WHERE numero_licitacion=%s
    """, (enmienda_actual, fecha, numero_licitacion))
    return True

def guardar_licitacion_radar(numero_licitacion, objeto, categoria, monto_estimado,
                              moneda, fecha_apertura, fecha_cierre, link_sli, es_prioritaria,
                              numero_enmienda=""):
    """Guarda una licitaciÃ³n descubierta por el radar. Retorna True si es nueva, False si ya existÃ­a."""
    conn = get_connection()
    c = conn.cursor()
    fecha = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    score = _calcular_score_radar(monto_estimado, es_prioritaria)
    numero_enmienda = _normalizar_enmienda_radar(numero_enmienda)

    try:
        _registrar_alerta_enmienda_si_aplica(c, numero_licitacion, numero_enmienda, fecha)
        c.execute("""INSERT INTO radar_licitaciones
            (numero_licitacion, objeto, categoria, monto_estimado, moneda,
             fecha_apertura, fecha_cierre, link_sli, es_prioritaria,
             numero_enmienda, fecha_descubierta, fecha_ultimo_escaneo, score_interes, estado_radar)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'nueva')
            ON CONFLICT (numero_licitacion) DO UPDATE SET
                objeto = EXCLUDED.objeto,
                categoria = EXCLUDED.categoria,
                moneda = EXCLUDED.moneda,
                fecha_apertura = EXCLUDED.fecha_apertura,
                fecha_cierre = EXCLUDED.fecha_cierre,
                link_sli = EXCLUDED.link_sli,
                es_prioritaria = EXCLUDED.es_prioritaria,
                numero_enmienda = EXCLUDED.numero_enmienda,
                fecha_ultimo_escaneo = EXCLUDED.fecha_ultimo_escaneo,
                score_interes = EXCLUDED.score_interes,
                monto_estimado = CASE WHEN EXCLUDED.monto_estimado > 0 THEN EXCLUDED.monto_estimado ELSE radar_licitaciones.monto_estimado END
        """, (numero_licitacion, objeto, categoria, monto_estimado, moneda,
              fecha_apertura, fecha_cierre, link_sli, es_prioritaria, numero_enmienda, fecha, fecha, score))

        # Verificar si fue INSERT o UPDATE
        fue_nueva = c.rowcount > 0
        conn.commit()
        conn.close()

        # Verificar si realmente es nueva (no existÃ­a antes)
        conn2 = get_connection()
        c2 = conn2.cursor()
        c2.execute("SELECT fecha_descubierta FROM radar_licitaciones WHERE numero_licitacion=%s", (numero_licitacion,))
        row = c2.fetchone()
        conn2.close()
        if row and row[0] == fecha:
            return True  # Es nueva
        return False  # Ya existÃ­a
    except Exception as e:
        print(f"[RADAR DB] Error guardando {numero_licitacion}: {e}")
        conn.close()
        return False


def guardar_licitaciones_radar_bulk(licitaciones):
    """Guarda muchas licitaciones del radar con una sola conexion. Retorna (nuevas, total)."""
    if not licitaciones:
        return 0, 0

    fecha = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    numeros = [str(lic.get("numero_licitacion", "")).strip() for lic in licitaciones if lic.get("numero_licitacion")]
    if not numeros:
        return 0, 0

    conn = get_connection()
    c = conn.cursor()
    placeholders = ",".join(["%s"] * len(numeros))
    c.execute(f"""
        SELECT numero_licitacion, numero_enmienda, estado_radar
        FROM radar_licitaciones
        WHERE numero_licitacion IN ({placeholders})
    """, tuple(numeros))
    existentes_data = {
        str(row[0]): {
            "numero_enmienda": _normalizar_enmienda_radar(row[1]),
            "estado_radar": str(row[2] or ""),
        }
        for row in c.fetchall()
    }
    existentes = set(existentes_data.keys())

    values = []
    for lic in licitaciones:
        numero = str(lic.get("numero_licitacion", "")).strip()
        if not numero:
            continue
        monto = float(lic.get("monto_estimado", 0) or 0)
        es_prioritaria = bool(lic.get("es_prioritaria", False))
        score = _calcular_score_radar(monto, es_prioritaria)
        enmienda_nueva = _normalizar_enmienda_radar(lic.get("numero_enmienda", ""))
        existente = existentes_data.get(numero)
        if existente and existente["estado_radar"] in ("descartada", "en_seguimiento"):
            enmienda_actual = existente["numero_enmienda"]
            if enmienda_nueva and enmienda_nueva != enmienda_actual:
                c.execute("""
                    UPDATE radar_licitaciones
                    SET enmienda_anterior=%s,
                        enmienda_alerta=TRUE,
                        fecha_enmienda_alerta=%s
                    WHERE numero_licitacion=%s
                """, (enmienda_actual, fecha, numero))
        values.append((
            numero,
            lic.get("objeto", ""),
            lic.get("categoria", "General (Autodetectado)"),
            monto,
            lic.get("moneda", "USD"),
            lic.get("fecha_apertura", ""),
            lic.get("fecha_cierre", ""),
            lic.get("link_sli", ""),
            es_prioritaria,
            enmienda_nueva,
            fecha,
            fecha,
            score,
            "nueva",
        ))

    if not values:
        conn.close()
        return 0, 0

    execute_values(c, """
        INSERT INTO radar_licitaciones
            (numero_licitacion, objeto, categoria, monto_estimado, moneda,
             fecha_apertura, fecha_cierre, link_sli, es_prioritaria,
             numero_enmienda, fecha_descubierta, fecha_ultimo_escaneo, score_interes, estado_radar)
        VALUES %s
        ON CONFLICT (numero_licitacion) DO UPDATE SET
            objeto = EXCLUDED.objeto,
            categoria = EXCLUDED.categoria,
            moneda = EXCLUDED.moneda,
            fecha_apertura = EXCLUDED.fecha_apertura,
            fecha_cierre = EXCLUDED.fecha_cierre,
            link_sli = EXCLUDED.link_sli,
            es_prioritaria = EXCLUDED.es_prioritaria,
            numero_enmienda = EXCLUDED.numero_enmienda,
            fecha_ultimo_escaneo = EXCLUDED.fecha_ultimo_escaneo,
            score_interes = EXCLUDED.score_interes,
            monto_estimado = CASE WHEN EXCLUDED.monto_estimado > 0 THEN EXCLUDED.monto_estimado ELSE radar_licitaciones.monto_estimado END
    """, values)
    conn.commit()
    conn.close()

    nuevas = len([n for n in numeros if n not in existentes])
    return nuevas, len(values)


def get_licitaciones_radar(solo_nuevas=False, solo_hoy=False):
    """Retorna las licitaciones del radar."""
    conn = get_connection()
    query = "SELECT * FROM radar_licitaciones"
    conditions = []
    if solo_nuevas:
        conditions.append("estado_radar = 'nueva'")
    if solo_hoy:
        hoy = datetime.now().strftime("%Y-%m-%d")
        conditions.append(f"fecha_descubierta LIKE '{hoy}%'")
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY score_interes DESC, monto_estimado DESC"
    df = pd.read_sql_query(query, conn)
    conn.close()
    return df


def marcar_licitacion_radar(licitacion_id, estado, usuario, notas=""):
    """Marca una licitaciÃ³n del radar como revisada/descartada/en_seguimiento."""
    conn = get_connection()
    c = conn.cursor()
    c.execute("UPDATE radar_licitaciones SET estado_radar=%s, revisada_por=%s, notas=%s WHERE id=%s",
              (estado, usuario, notas, licitacion_id))
    conn.commit()
    conn.close()


def marcar_alerta_enmienda_revisada(licitacion_id):
    """Limpia la alerta de enmienda de una licitaciÃ³n del radar."""
    conn = get_connection()
    c = conn.cursor()
    c.execute("""
        UPDATE radar_licitaciones
        SET enmienda_alerta=FALSE
        WHERE id=%s
    """, (licitacion_id,))
    conn.commit()
    conn.close()


def eliminar_licitaciones_radar(ids):
    """Elimina licitaciones del radar por ID. Retorna cuantas filas fueron borradas."""
    ids = [int(i) for i in ids if str(i).isdigit()]
    if not ids:
        return 0
    conn = get_connection()
    c = conn.cursor()
    placeholders = ",".join(["%s"] * len(ids))
    c.execute(f"DELETE FROM radar_licitaciones WHERE id IN ({placeholders})", tuple(ids))
    deleted = c.rowcount
    conn.commit()
    conn.close()
    return deleted


def eliminar_radar_fuera_de_numeros(numeros):
    """Elimina del radar licitaciones que ya no aparecen en el escaneo completo de abiertas."""
    numeros = [str(n).strip() for n in numeros if str(n).strip()]
    if not numeros:
        return 0
    conn = get_connection()
    c = conn.cursor()
    placeholders = ",".join(["%s"] * len(numeros))
    c.execute(f"DELETE FROM radar_licitaciones WHERE numero_licitacion NOT IN ({placeholders})", tuple(numeros))
    deleted = c.rowcount
    conn.commit()
    conn.close()
    return deleted


def registrar_escaneo_radar(total, nuevas, errores="", paginas_recorridas=0,
                            total_detectadas_portal=0, metodo="", escaneo_completo=False):
    """Registra un escaneo del radar en el log."""
    conn = get_connection()
    c = conn.cursor()
    fecha = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    c.execute("""INSERT INTO radar_escaneos
        (fecha, total_encontradas, nuevas, errores, paginas_recorridas,
         total_detectadas_portal, metodo, escaneo_completo)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
        (fecha, total, nuevas, errores, int(paginas_recorridas or 0),
         int(total_detectadas_portal or 0), metodo or "", bool(escaneo_completo)))
    conn.commit()
    conn.close()


def get_ultimos_escaneos(limite=10):
    """Retorna los Ãºltimos escaneos del radar."""
    conn = get_connection()
    df = pd.read_sql_query(
        f"SELECT * FROM radar_escaneos ORDER BY id DESC LIMIT {limite}", conn)
    conn.close()
    return df



