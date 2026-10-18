"""Exporta el contrato OpenAPI del servicio a analytics/openapi.json.
A partir de él, `npm run gen:analytics-types` genera lib/analytics-api.d.ts."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.main import create_app  # noqa: E402

spec = create_app(repository=object(), api_key="").openapi()  # type: ignore[arg-type]
out = ROOT / "openapi.json"
out.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"OpenAPI exportado a {out}")
