"""
SLI Scraper - Radar de licitaciones abiertas de la ACP.

Consulta el portal publico del SLI, recorre todas las paginas de resultados
y guarda las licitaciones abiertas en la tabla radar_licitaciones.
"""

import re
import unicodedata
from datetime import datetime
from urllib.parse import parse_qs, urljoin, urlparse

import requests
import urllib3
from bs4 import BeautifulSoup

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

SLI_BASE = "https://apps.pancanal.com/sli"
SLI_SEARCH_URL = f"{SLI_BASE}/LicitacionesBusqueda/LicitacionesBusquedaParametros"
SLI_RESULTS_URL = f"{SLI_BASE}/LicitacionesBusqueda/BusquedaLicitacionesResultados"

CATEGORIAS_PRIORITARIAS = [
    "Electrical & Electronics",
    "Fabricated (ACP)",
    "Communications Equipment",
    "Pumps/Compressors",
    "Hydraulic",
    "Mechanical Power Transmission",
    "Engines & related component(non-vehicle)",
    "Construction/Mining",
    "Construction Material",
    "Alarm, Signal & Detection",
    "Instruments/Lab Equip",
    "Metalworking",
]

MESES_SLI = {
    "ene": 1,
    "feb": 2,
    "mar": 3,
    "abr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "ago": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dic": 12,
}


def parse_sli_datetime(value):
    if not value:
        return None
    raw = re.sub(r"\s+", " ", str(value).replace("\xa0", " ")).strip()
    if not raw:
        return None

    for candidate in (raw, raw.replace("Z", "+00:00")):
        try:
            parsed = datetime.fromisoformat(candidate)
            return parsed.replace(tzinfo=None) if parsed.tzinfo else parsed
        except ValueError:
            pass

    text = unicodedata.normalize("NFD", raw.lower())
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    text = re.sub(r"\s+", " ", text.replace(".", " ")).strip()
    match = re.search(
        r"(\d{1,2})[-/\s]([a-z]{3,})[-/\s](\d{4})\s+(\d{1,2}):(\d{2})(?:\s*([ap])\s*m?)?",
        text,
        re.IGNORECASE,
    )
    if not match:
        return None

    dia, mes_txt, anio, hora, minuto, ampm = match.groups()
    mes = MESES_SLI.get(mes_txt[:3])
    if not mes:
        return None

    hora = int(hora)
    if (ampm or "").lower() == "p" and hora != 12:
        hora += 12
    if (ampm or "").lower() == "a" and hora == 12:
        hora = 0

    try:
        return datetime(int(anio), mes, int(dia), hora, int(minuto))
    except ValueError:
        return None


def _extraer_monto_texto(texto):
    if not texto:
        return 0.0
    patterns = [
        r"[\$B/\.]+\s*([\d,]+(:\.\d{2}))",
        r"([\d,]+(:\.\d{2}))\s*(:USD|PAB|B/\.)",
    ]
    for pattern in patterns:
        match = re.search(pattern, texto)
        if match:
            try:
                return float(match.group(1).replace(",", ""))
            except ValueError:
                continue
    return 0.0


def _extraer_max_pagina(soup):
    paginas = {1}
    for link in soup.find_all("a", href=True):
        href = link.get("href") or ""
        if "BusquedaLicitacionesResultados" not in href or "pagina=" not in href:
            continue
        qs = parse_qs(urlparse(href).query)
        for value in qs.get("pagina", []):
            if str(value).isdigit():
                paginas.add(int(value))
    return max(paginas) if paginas else 1


def _extraer_urls_paginacion(soup):
    urls = {}
    for link in soup.find_all("a", href=True):
        href = link.get("href") or ""
        text = link.get_text(" ", strip=True)
        if "BusquedaLicitacionesResultados" not in href and "pagina=" not in href:
            continue
        qs = parse_qs(urlparse(href).query)
        page_num = None
        for key in ["pagina", "page", "Page", "PageNumber"]:
            values = qs.get(key, [])
            if values and str(values[0]).isdigit():
                page_num = int(values[0])
                break
        if page_num is None and text.isdigit():
            page_num = int(text)
        if page_num and page_num > 1:
            urls[page_num] = urljoin(SLI_BASE, href)
    return urls


def _contar_resultados_sli(soup):
    return len(soup.find_all("a", id="link_BiddingNumber"))


def _scan_meta(metodo, paginas_recorridas=0, total_detectadas_portal=0, escaneo_completo=False, errores=""):
    return {
        "metodo": metodo,
        "paginas_recorridas": int(paginas_recorridas or 0),
        "total_detectadas_portal": int(total_detectadas_portal or 0),
        "escaneo_completo": bool(escaneo_completo),
        "errores": errores or "",
    }


def _click_visible_page_link(page, page_number):
    selectors = [
        f".pagination a[href*='pagina={page_number}']",
        f".pagination a:has-text('{page_number}')",
        f"nav a[href*='pagina={page_number}']",
        f"a[href*='pagina={page_number}']",
    ]
    for selector in selectors:
        locator = page.locator(selector).filter(visible=True)
        if locator.count() > 0:
            locator.first.click()
            return True

    return bool(page.evaluate(
        """pageNumber => {
            const links = Array.from(document.querySelectorAll('a'));
            const target = links.find(a => {
                const text = (a.textContent || '').trim();
                const href = a.getAttribute('href') || '';
                const rect = a.getBoundingClientRect();
                const style = window.getComputedStyle(a);
                const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
                const inHiddenMenu = !!a.closest('.bootstrap-select, .dropdown-menu, [aria-hidden="true"]');
                return visible && !inHiddenMenu && (text === String(pageNumber) || href.includes('pagina=' + pageNumber));
            });
            if (!target) return false;
            target.click();
            return true;
        }""",
        int(page_number)
    ))


def _parsear_resultados_sli(soup):
    resultados = []
    items = soup.find_all("a", id="link_BiddingNumber")

    for item in items:
        numero = item.text.strip()
        link = item.get("href", "")
        if link and not link.startswith("http"):
            link = urljoin("https://apps.pancanal.com", link)

        container = item.find_parent("div", class_="col-lg-9") or item.find_parent("div")
        if not container:
            continue

        objeto_tag = container.find("p", class_="title")
        objeto = objeto_tag.text.strip() if objeto_tag else ""
        if not objeto:
            textos = [t.strip() for t in container.stripped_strings if t.strip()]
            try:
                idx = textos.index(numero)
                objeto = textos[idx + 1] if idx + 1 < len(textos) else ""
            except ValueError:
                objeto = ""

        texto_completo = container.text
        apertura = ""
        apertura_match = re.search(
            r"Fecha\s+de\s+publicaci\S+n\s*([\d\-A-Za-z]+\s+[\d:]+\s+[APM]+)",
            texto_completo,
            re.IGNORECASE,
        )
        if apertura_match:
            apertura = apertura_match.group(1).strip()

        cierre = ""
        cierre_match = re.search(
            r"Fecha\s+y\s+hora\s+de\s+cierre\s*([\d\-A-Za-z]+\s+[\d:]+\s+[APM]+)",
            texto_completo,
            re.IGNORECASE,
        )
        if cierre_match:
            cierre = re.sub(r"\s+", " ", cierre_match.group(1).replace("\xa0", " ")).strip()

        enmienda = ""
        enmienda_match = re.search(
            r"#\s*Enmienda\s*([A-Za-z0-9\-_/]*)",
            texto_completo,
            re.IGNORECASE,
        )
        if enmienda_match:
            enmienda = re.sub(r"\s+", " ", enmienda_match.group(1).replace("\xa0", " ")).strip()

        objeto_lower = objeto.lower()
        es_prioritaria = any(
            key in objeto_lower
            for key in [
                "elect",
                "cable",
                "motor",
                "bomba",
                "panel",
                "transformador",
                "breaker",
                "sensor",
                "hidraul",
                "valvula",
                "repuesto",
            ]
        )

        resultados.append(
            {
                "numero_licitacion": numero,
                "objeto": objeto,
                "categoria": "General (Autodetectado)",
                "monto_estimado": _extraer_monto_texto(objeto),
                "moneda": "USD",
                "fecha_apertura": apertura,
                "fecha_cierre": cierre,
                "numero_enmienda": enmienda,
                "link_sli": link,
                "es_prioritaria": es_prioritaria,
                "fecha_descubierta": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }
        )

    return resultados


def _set_input_value(page, selectors, value):
    for selector in selectors:
        locator = page.locator(selector)
        if locator.count() > 0:
            try:
                locator.first.fill(str(value or ""))
                return True
            except Exception:
                try:
                    page.evaluate(
                        """([selector, value]) => {
                            const el = document.querySelector(selector);
                            if (el) {
                                el.value = value || '';
                                el.dispatchEvent(new Event('input', {bubbles: true}));
                                el.dispatchEvent(new Event('change', {bubbles: true}));
                            }
                        }""",
                        [selector, str(value or "")]
                    )
                    return True
                except Exception:
                    continue
    return False


def _select_or_set_value(page, selectors, value):
    for selector in selectors:
        locator = page.locator(selector)
        if locator.count() > 0:
            try:
                locator.first.select_option(str(value))
                return True
            except Exception:
                try:
                    page.evaluate(
                        """([selector, value]) => {
                            const el = document.querySelector(selector);
                            if (el) {
                                el.value = value;
                                el.dispatchEvent(new Event('change', {bubbles: true}));
                            }
                        }""",
                        [selector, str(value)]
                    )
                    return True
                except Exception:
                    continue
    return False


def _parse_soups(soups):
    unicos = {}
    now = datetime.now()
    for soup in soups:
        for lic in _parsear_resultados_sli(soup):
            cierre_dt = parse_sli_datetime(lic.get("fecha_cierre"))
            if cierre_dt and cierre_dt < now:
                continue
            numero = lic["numero_licitacion"]
            if numero not in unicos:
                unicos[numero] = lic

    resultados = list(unicos.values())

    def sort_key(lic):
        cierre_dt = parse_sli_datetime(lic.get("fecha_cierre"))
        apertura_dt = parse_sli_datetime(lic.get("fecha_apertura"))
        return (
            cierre_dt or datetime.max,
            apertura_dt or datetime.max,
            str(lic.get("numero_licitacion", "")),
        )

    resultados.sort(key=sort_key)
    return resultados


def escanear_licitaciones_abiertas_playwright(
    palabra_clave="",
    numero_licitacion="",
    categoria="TODOS",
    max_paginas=50,
):
    from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
    from playwright.sync_api import sync_playwright

    palabra_clave = (palabra_clave or "").strip()
    numero_licitacion = re.sub(r"\D", "", str(numero_licitacion or ""))
    categoria = (categoria or "TODOS").strip() or "TODOS"
    errores = []
    soups = []
    paginas_visitadas = set()

    print("[RADAR] Escaneo Playwright: abriendo SLI...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
        context = browser.new_context(ignore_https_errors=True, locale="es-PA")
        page = context.new_page()
        page.set_default_timeout(20000)
        try:
            page.goto(SLI_BASE, wait_until="domcontentloaded", timeout=45000)
            page.wait_for_timeout(1000)

            _set_input_value(page, ["input[name='Descripcion']", "#Descripcion", "input[placeholder*='Palabra']"], palabra_clave)
            _set_input_value(page, ["input[name='NumeroLicitacion']", "#NumeroLicitacion", "input[placeholder*='licitaci']"], numero_licitacion)
            _select_or_set_value(page, ["select[name='status']", "#status", "#hfEstatusSeleccionadoID"], "AN")
            _select_or_set_value(page, ["select[name='EstatusSeleccionadoID']", "#EstatusSeleccionadoID"], "AN")
            _select_or_set_value(page, ["select[name='categorias']", "#categorias", "select[name='CategoriaSeleccionadaID']"], categoria)
            _select_or_set_value(page, ["select[name='Text']", "#Text"], "100")
            page.evaluate(
                """() => {
                    for (const [selector, value] of [
                        ['input[name="status"]', 'AN'],
                        ['input[name="EstatusSeleccionadoID"]', 'AN'],
                        ['input[name="Text"]', '100'],
                        ['#hfEstatusSeleccionadoID', 'AN']
                    ]) {
                        const el = document.querySelector(selector);
                        if (el) el.value = value;
                    }
                }"""
            )

            clicked = False
            for selector in ["input[name='submitBusqueda3']", "button[type='submit']", "input[type='submit']", "button:has-text('Buscar')"]:
                locator = page.locator(selector)
                if locator.count() > 0:
                    locator.first.click()
                    clicked = True
                    break
            if not clicked:
                page.evaluate("document.querySelector('form').submit()")

            try:
                page.wait_for_selector("#link_BiddingNumber, a[id='link_BiddingNumber']", timeout=45000)
            except PlaywrightTimeoutError:
                errores.append("No aparecieron resultados de licitaciones en el SLI.")

            pagina_actual = 1
            while pagina_actual <= int(max_paginas or 50):
                page.wait_for_timeout(700)
                soup = BeautifulSoup(page.content(), "html.parser")
                if pagina_actual not in paginas_visitadas:
                    soups.append(soup)
                    paginas_visitadas.add(pagina_actual)

                next_page = pagina_actual + 1
                max_detected = min(_extraer_max_pagina(soup), int(max_paginas or 50))
                if pagina_actual >= max_detected:
                    break
                try:
                    current_first = page.locator("#link_BiddingNumber").first.inner_text(timeout=3000)
                except Exception:
                    current_first = ""
                if not _click_visible_page_link(page, next_page):
                    errores.append(f"No se pudo abrir la pagina {next_page} de {max_detected}.")
                    break
                try:
                    page.wait_for_load_state("networkidle", timeout=12000)
                except Exception:
                    pass
                try:
                    if current_first:
                        page.wait_for_function(
                            """first => {
                                const el = document.querySelector('#link_BiddingNumber');
                                return el && el.innerText.trim() !== first.trim();
                            }""",
                            current_first,
                            timeout=8000,
                        )
                except Exception:
                    pass
                pagina_actual = next_page

        finally:
            browser.close()

    resultados = _parse_soups(soups)
    total_detectadas = sum(_contar_resultados_sli(soup) for soup in soups)
    completo = bool(soups) and not errores
    meta = _scan_meta(
        "playwright",
        paginas_recorridas=len(paginas_visitadas),
        total_detectadas_portal=total_detectadas,
        escaneo_completo=completo,
        errores=" | ".join(errores),
    )
    print(f"[RADAR] Playwright completo={completo}: {len(resultados)} unicas, {len(paginas_visitadas)} paginas.")
    return resultados, meta


def _escanear_licitaciones_abiertas_requests(
    palabra_clave="",
    numero_licitacion="",
    categoria="TODOS",
    max_paginas=30,
):
    session = requests.Session()
    session.verify = False
    errores = []
    palabra_clave = (palabra_clave or "").strip()
    numero_licitacion = re.sub(r"\D", "", str(numero_licitacion or ""))
    categoria = (categoria or "TODOS").strip() or "TODOS"

    print("[RADAR] Obteniendo token de sesion del SLI...")
    try:
        resp_home = session.get(SLI_BASE, timeout=30)
        resp_home.raise_for_status()
    except Exception as exc:
        print(f"[RADAR] Error accediendo al SLI: {exc}")
        return [], _scan_meta("requests", errores=f"Error accediendo al SLI: {exc}")

    soup_home = BeautifulSoup(resp_home.text, "html.parser")
    token_input = soup_home.find("input", {"name": "__RequestVerificationToken"})
    if not token_input:
        print("[RADAR] No se encontro __RequestVerificationToken en la pagina principal.")
        return [], _scan_meta("requests", errores="No se encontro token de sesion del SLI.")

    payload = {
        "Descripcion": [palabra_clave, palabra_clave],
        "NumeroLicitacion": numero_licitacion,
        "status": "AN",
        "EstatusSeleccionadoID": "AN",
        "categorias": categoria,
        "CategoriaSeleccionadaID": categoria,
        "Text": "100",
        "__RequestVerificationToken": token_input["value"],
        "submitBusqueda3": "Buscar",
    }

    print("[RADAR] Buscando licitaciones abiertas...")
    try:
        resp = session.post(SLI_SEARCH_URL, data=payload, timeout=60)
        resp.raise_for_status()
    except Exception as exc:
        print(f"[RADAR] Error enviando formulario de busqueda: {exc}")
        return [], _scan_meta("requests", errores=f"Error enviando formulario de busqueda: {exc}")

    soups = [BeautifulSoup(resp.text, "html.parser")]
    max_pagina = min(_extraer_max_pagina(soups[0]), int(max_paginas or 30))
    page_urls = _extraer_urls_paginacion(soups[0])
    print(f"[RADAR] Paginas detectadas: {max_pagina}")

    for pagina in range(2, max_pagina + 1):
        page_url = page_urls.get(pagina) or f"{SLI_RESULTS_URL}pagina={pagina}"
        try:
            page_resp = session.get(page_url, timeout=45)
            page_resp.raise_for_status()
            soups.append(BeautifulSoup(page_resp.text, "html.parser"))
        except Exception as exc:
            print(f"[RADAR] Error obteniendo pagina {pagina}: {exc}")
            errores.append(f"Error obteniendo pagina {pagina}: {exc}")

    unicos = {}
    now = datetime.now()
    for soup in soups:
        for lic in _parsear_resultados_sli(soup):
            cierre_dt = parse_sli_datetime(lic.get("fecha_cierre"))
            if cierre_dt and cierre_dt < now:
                continue
            numero = lic["numero_licitacion"]
            if numero not in unicos:
                unicos[numero] = lic

    resultados = list(unicos.values())

    def sort_key(lic):
        cierre_dt = parse_sli_datetime(lic.get("fecha_cierre"))
        apertura_dt = parse_sli_datetime(lic.get("fecha_apertura"))
        return (
            cierre_dt or datetime.max,
            apertura_dt or datetime.max,
            str(lic.get("numero_licitacion", "")),
        )

    resultados.sort(key=sort_key)
    print(f"[RADAR] Parseo completado: {len(resultados)} licitaciones abiertas unicas listas.")
    meta = _scan_meta(
        "requests",
        paginas_recorridas=len(soups),
        total_detectadas_portal=sum(_contar_resultados_sli(soup) for soup in soups),
        escaneo_completo=(len(soups) >= max_pagina and not errores),
        errores=" | ".join(errores),
    )
    return resultados, meta


def escanear_licitaciones_abiertas_con_metadata(
    palabra_clave="",
    numero_licitacion="",
    categoria="TODOS",
    max_paginas=50,
):
    es_escaneo_global = not (palabra_clave or "").strip() and not re.sub(r"\D", "", str(numero_licitacion or "")) and (categoria or "TODOS").strip() == "TODOS"
    try:
        licitaciones, meta = escanear_licitaciones_abiertas_playwright(
            palabra_clave=palabra_clave,
            numero_licitacion=numero_licitacion,
            categoria=categoria,
            max_paginas=max_paginas,
        )
        if es_escaneo_global and len(licitaciones) < 20:
            raise RuntimeError(
                f"Playwright devolvio solo {len(licitaciones)} licitaciones en escaneo global; se validara con POST directo."
            )
        return licitaciones, meta
    except Exception as exc:
        print(f"[RADAR] Playwright no disponible o fallo el escaneo completo: {exc}")
        licitaciones, meta = _escanear_licitaciones_abiertas_requests(
            palabra_clave=palabra_clave,
            numero_licitacion=numero_licitacion,
            categoria=categoria,
            max_paginas=max_paginas,
        )
        if meta.get("escaneo_completo") and not meta.get("errores"):
            return licitaciones, meta
        if not meta.get("errores"):
            meta["errores"] = f"Playwright no completo: {exc}. Se uso POST directo del SLI."
        else:
            meta["errores"] = f"Playwright no completo: {exc}. {meta.get('errores')}"
        return licitaciones, meta


def escanear_licitaciones_abiertas(
    palabra_clave="",
    numero_licitacion="",
    categoria="TODOS",
    max_paginas=50,
):
    licitaciones, _ = escanear_licitaciones_abiertas_con_metadata(
        palabra_clave=palabra_clave,
        numero_licitacion=numero_licitacion,
        categoria=categoria,
        max_paginas=max_paginas,
    )
    return licitaciones


def ejecutar_radar_detallado(db_module=None, palabra_clave="", numero_licitacion="", categoria="TODOS"):
    if db_module is None:
        import database as db_module

    errores = ""
    meta = _scan_meta("sin_ejecutar")
    try:
        licitaciones, meta = escanear_licitaciones_abiertas_con_metadata(
            palabra_clave=palabra_clave,
            numero_licitacion=numero_licitacion,
            categoria=categoria,
        )
        errores = str(meta.get("errores", "") or "")
    except Exception as exc:
        licitaciones = []
        errores = str(exc)
        meta = _scan_meta("error", errores=errores)

    nuevas = 0
    total = len(licitaciones)

    if hasattr(db_module, "guardar_licitaciones_radar_bulk"):
        nuevas, total = db_module.guardar_licitaciones_radar_bulk(licitaciones)
    else:
        for lic in licitaciones:
            fue_nueva = db_module.guardar_licitacion_radar(
                numero_licitacion=lic["numero_licitacion"],
                objeto=lic["objeto"],
                categoria=lic["categoria"],
                monto_estimado=lic["monto_estimado"],
                moneda=lic["moneda"],
                fecha_apertura=lic["fecha_apertura"],
                fecha_cierre=lic["fecha_cierre"],
                link_sli=lic["link_sli"],
                es_prioritaria=lic["es_prioritaria"],
            )
            if fue_nueva:
                nuevas += 1

    obsoletas_eliminadas = 0
    es_escaneo_completo = not palabra_clave and not numero_licitacion and categoria == "TODOS"
    cobertura_confirmada = bool(meta.get("escaneo_completo"))
    if es_escaneo_completo and licitaciones and cobertura_confirmada and hasattr(db_module, "eliminar_radar_fuera_de_numeros"):
        numeros_abiertos = [lic["numero_licitacion"] for lic in licitaciones]
        obsoletas_eliminadas = db_module.eliminar_radar_fuera_de_numeros(numeros_abiertos)
    elif es_escaneo_completo and licitaciones and not cobertura_confirmada:
        warning = "Cobertura SLI no confirmada; no se eliminaron licitaciones fuera del escaneo."
        errores = f"{errores} | {warning}".strip(" |")

    if hasattr(db_module, "registrar_escaneo_radar"):
        try:
            db_module.registrar_escaneo_radar(
                total,
                nuevas,
                errores,
                paginas_recorridas=meta.get("paginas_recorridas", 0),
                total_detectadas_portal=meta.get("total_detectadas_portal", 0),
                metodo=meta.get("metodo", ""),
                escaneo_completo=meta.get("escaneo_completo", False),
            )
        except Exception as exc:
            errores = f"{errores} | Error registrando escaneo: {exc}".strip(" |")

    print(f"[RADAR] Resultados: {nuevas} nuevas de {total} totales")
    return {
        "total": total,
        "nuevas": nuevas,
        "actualizadas": max(total - nuevas, 0),
        "obsoletas_eliminadas": obsoletas_eliminadas,
        "errores": errores,
        "licitaciones": licitaciones,
        "paginas_recorridas": meta.get("paginas_recorridas", 0),
        "total_detectadas_portal": meta.get("total_detectadas_portal", 0),
        "metodo": meta.get("metodo", ""),
        "escaneo_completo": meta.get("escaneo_completo", False),
    }


def ejecutar_radar(db_module=None):
    resultado = ejecutar_radar_detallado(db_module=db_module)
    return resultado["nuevas"], resultado["total"]


if __name__ == "__main__":
    import io
    import sys

    from dotenv import load_dotenv

    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    load_dotenv()

    print("[RADAR] Ejecutando Radar SLI manualmente...")
    lics = escanear_licitaciones_abiertas()
    if lics:
        print(f"\n[RADAR] {len(lics)} licitaciones encontradas:\n")
        for i, lic in enumerate(lics[:30], 1):
            prio = "[PRIO]" if lic["es_prioritaria"] else "      "
            monto_str = f"${lic['monto_estimado']:,.2f}" if lic["monto_estimado"] > 0 else "Sin monto"
            print(f"{prio} {i}. [{lic['numero_licitacion']}] {lic['objeto'][:90]}")
            print(f"       Monto: {monto_str} | Apertura: {lic['fecha_apertura']} | Cierre: {lic['fecha_cierre']}")
            print()
    else:
        print("[RADAR] No se encontraron licitaciones. Verificar la conexion al SLI.")
