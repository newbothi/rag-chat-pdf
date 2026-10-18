"""Configuración del servicio de análisis.

Lee el MISMO .env.local que usa Next.js (en la raíz del proyecto), así la
conexión a SQL Server, el secreto compartido y el umbral de relevancia se
definen en un solo lugar.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ANALYTICS_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = ANALYTICS_DIR.parent

# .env.local de la raíz (Next.js) y, opcionalmente, uno propio en analytics/
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(ANALYTICS_DIR / ".env", override=True)


def _float(name: str, default: float) -> float:
    value = os.getenv(name)
    return float(value) if value not in (None, "") else default


@dataclass(frozen=True)
class Settings:
    api_key: str = os.getenv("ANALYTICS_API_KEY", "")

    db_server: str = os.getenv("DB_SERVER", "localhost")
    db_instance: str = os.getenv("DB_INSTANCE", "")
    db_port: str = os.getenv("DB_PORT", "1433")
    db_name: str = os.getenv("DB_NAME", "RagChat")
    db_user: str = os.getenv("DB_USER", "")
    db_password: str = os.getenv("DB_PASSWORD", "")
    db_trust_cert: bool = os.getenv("DB_TRUST_CERT", "true").lower() != "false"
    odbc_driver: str = os.getenv("ODBC_DRIVER", "ODBC Driver 18 for SQL Server")

    # Similitud a partir de la cual un fragmento se considera relevante (bge-m3).
    relevance_threshold: float = _float("RELEVANCE_THRESHOLD", 0.5)
    # Un tema se considera "sin cobertura" si la similitud media de su mejor fragmento es menor a esto.
    gap_threshold: float = _float("GAP_THRESHOLD", 0.5)

    embedding_base_url: str = os.getenv("EMBEDDING_BASE_URL", "http://localhost:1234/v1")
    embedding_model: str = os.getenv("EMBEDDING_MODEL", "text-embedding-bge-m3")

    model_path: Path = ANALYTICS_DIR / "models" / "confidence.joblib"

    @property
    def connection_string(self) -> str:
        return build_connection_string(
            server=self.db_server,
            instance=self.db_instance,
            port=self.db_port,
            database=self.db_name,
            user=self.db_user,
            password=self.db_password,
            trust_cert=self.db_trust_cert,
            driver=self.odbc_driver,
        )


def build_connection_string(
    *, server: str, instance: str, port: str, database: str, user: str, password: str, trust_cert: bool, driver: str
) -> str:
    host = f"{server}\\{instance}" if instance else f"{server},{port or 1433}"

    # Las llaves protegen valores con ';' o '}' (ODBC: '}' se escapa como '}}')
    def quote(value: str) -> str:
        return "{" + value.replace("}", "}}") + "}"

    return (
        f"DRIVER={{{driver}}};SERVER={host};DATABASE={quote(database)};"
        f"UID={quote(user)};PWD={quote(password)};Encrypt=yes;"
        f"TrustServerCertificate={'yes' if trust_cert else 'no'};"
    )


settings = Settings()
