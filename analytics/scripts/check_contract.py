"""Verifica que analytics/openapi.json (commiteado) coincida con el contrato real
de FastAPI. Si alguien cambia un modelo Pydantic o un endpoint y no regenera los
tipos (`npm run gen:analytics-types`), este script falla en CI.

Compara solo `paths` y `components` (lo que define el contrato), no el formato
del archivo ni metadatos como la versión de OpenAPI.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.main import create_app  # noqa: E402

committed = json.loads((ROOT / "openapi.json").read_text(encoding="utf-8"))
current = create_app(repository=object(), api_key="").openapi()  # type: ignore[arg-type]

problems: list[str] = []
for section in ("paths", "components"):
    before, after = committed.get(section, {}), current.get(section, {})
    if before == after:
        continue
    keys = sorted(set(before) | set(after))
    if section == "components":
        before, after = before.get("schemas", {}), after.get("schemas", {})
        keys = sorted(set(before) | set(after))
    for key in keys:
        if before.get(key) != after.get(key):
            state = "nuevo" if key not in before else "eliminado" if key not in after else "modificado"
            problems.append(f"  - {section}: {key} ({state})")

if problems:
    print("✗ El contrato de FastAPI cambió y los tipos de TypeScript están desactualizados:")
    print("\n".join(problems))
    print("\nEjecuta `npm run gen:analytics-types` y commitea analytics/openapi.json y lib/analytics-api.d.ts.")
    sys.exit(1)

print("✓ El contrato OpenAPI coincide con el código de FastAPI.")
