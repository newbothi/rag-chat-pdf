from app.config import build_connection_string

BASE = dict(
    server="localhost",
    instance="",
    port="1433",
    database="RagChat",
    user="rag_app",
    password="secreta",
    trust_cert=True,
    driver="ODBC Driver 18 for SQL Server",
)


def test_default_instance_uses_port():
    cs = build_connection_string(**BASE)
    assert "SERVER=localhost,1433;" in cs
    assert "DRIVER={ODBC Driver 18 for SQL Server};" in cs
    assert "TrustServerCertificate=yes;" in cs


def test_named_instance_ignores_port():
    cs = build_connection_string(**{**BASE, "server": "NOTE-CRIS", "instance": "SQLEXPRESS"})
    assert "SERVER=NOTE-CRIS\\SQLEXPRESS;" in cs


def test_password_with_special_characters_is_quoted():
    # Sin comillas, el ';' cortaría la cadena y el resto se leería como otra opción
    cs = build_connection_string(**{**BASE, "password": "a;Encrypt=no;b}c"})
    assert "PWD={a;Encrypt=no;b}}c};" in cs
    assert cs.count("Encrypt=yes") == 1


def test_trust_cert_can_be_disabled():
    assert "TrustServerCertificate=no;" in build_connection_string(**{**BASE, "trust_cert": False})
