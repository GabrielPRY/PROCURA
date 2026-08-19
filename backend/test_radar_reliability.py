import unittest

from bs4 import BeautifulSoup

from api import _extract_radar_items_from_documents
from sli_scraper import _extraer_max_pagina, _extraer_urls_paginacion, parse_sli_datetime


def document(text):
    return [{
        "nombre": "Impresion_RFQ.pdf",
        "url": "https://example.test/rfq.pdf",
        "tipo": "rfq_pdf",
        "paginas": [{"pagina": 1, "texto": text}],
    }]


class RadarAcpParserTests(unittest.TestCase):
    def test_accepts_code_at_start_after_bare_row_number(self):
        items = _extract_radar_items_from_documents(
            document("1\nLLF-LAM-00402 DRG-BULB, LED, WHITE DIFFUSED\n10\nEACH")
        )
        self.assertEqual(items[0]["codigo_acp"], "LLF-LAM-00402")
        self.assertEqual(items[0]["renglon_numero"], "1")

    def test_rejects_code_without_real_row_context(self):
        items = _extract_radar_items_from_documents(
            document("Gate valve assembly\nREFERENCE ONLY\nPWR-BAT-00009 prior equipment code")
        )
        self.assertFalse(any(item.get("codigo_acp") for item in items))

    def test_rejects_code_inside_row_description(self):
        items = _extract_radar_items_from_documents(
            document("1\nGate valve, reference PWR-BAT-00009 for prior equipment only\n12\nEACH")
        )
        self.assertFalse(any(item.get("codigo_acp") for item in items))

    def test_detects_multiple_numbered_rows(self):
        items = _extract_radar_items_from_documents(
            document("1 LLF-LAM-00402 LED BULB\n2 PWR-BAT-00009 BATTERY\n3 Valve without ACP code")
        )
        self.assertEqual(
            [item.get("codigo_acp") for item in items if item.get("codigo_acp")],
            ["LLF-LAM-00402", "PWR-BAT-00009"],
        )


class RadarSliParsingTests(unittest.TestCase):
    def test_accepts_sli_date_variants(self):
        variants = [
            "19-ago-2026 11:30 AM",
            "19-ago-2026 11:30 a.m.",
            "19 ago 2026 11:30:15 AM",
        ]
        self.assertTrue(all(parse_sli_datetime(value) for value in variants))

    def test_detects_pagination_from_href_data_and_onclick(self):
        soup = BeautifulSoup(
            """
            <nav class="pagination">
              <a href="?pagina=2">2</a>
              <a href="#" data-page="7">7</a>
              <a href="#" onclick="goToPage(10)">10</a>
            </nav>
            """,
            "html.parser",
        )
        self.assertEqual(_extraer_max_pagina(soup), 10)
        self.assertIn(2, _extraer_urls_paginacion(soup))


if __name__ == "__main__":
    unittest.main()
