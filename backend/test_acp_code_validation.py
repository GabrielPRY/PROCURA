import unittest

from api import postprocess_technical_analysis


def source_document(text):
    return [{
        "nombre": "rfq.pdf",
        "url": "",
        "tipo": "rfq_pdf_subido",
        "paginas": [{"pagina": 1, "texto": text}],
    }]


def analysis(code, description):
    return {
        "condiciones_generales": {},
        "items": [{
            "renglon": "1",
            "codigo_articulo": code,
            "termino_de_busqueda_corto": description,
        }],
    }


class AcpCodeValidationTests(unittest.TestCase):
    def test_rejects_ai_code_missing_from_rfq_row(self):
        result = postprocess_technical_analysis(
            analysis("PWR-BAT-00009", "20-inch Gate Valves for Caisson II"),
            source_documents=source_document("1\n20-inch Gate Valves for Caisson II\n12\nEACH"),
        )

        self.assertEqual(result["items"][0]["codigo_articulo"], "")

    def test_accepts_code_at_start_of_real_rfq_row(self):
        result = postprocess_technical_analysis(
            analysis("LLF-LAM-00402", "LLF-LAM-00402 DRG-BULB, LED"),
            source_documents=source_document("1\nLLF-LAM-00402 DRG-BULB, LED\n10\nEACH"),
        )

        self.assertEqual(result["items"][0]["codigo_articulo"], "LLF-LAM-00402")

    def test_rejects_code_used_only_as_reference_inside_description(self):
        result = postprocess_technical_analysis(
            analysis("PWR-BAT-00009", "Valve assembly"),
            source_documents=source_document(
                "1\nValve assembly, reference PWR-BAT-00009 for prior equipment only\n2\nEACH"
            ),
        )

        self.assertEqual(result["items"][0]["codigo_articulo"], "")


if __name__ == "__main__":
    unittest.main()
