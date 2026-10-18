// Ejecuta el Python del entorno virtual de analytics/ (Windows, Linux o macOS).
// Uso: node scripts/py.mjs <argumentos de python>   (el directorio de trabajo es analytics/)
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const analyticsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'analytics');
const venvPython =
  process.platform === 'win32'
    ? join(analyticsDir, '.venv', 'Scripts', 'python.exe')
    : join(analyticsDir, '.venv', 'bin', 'python');

if (!existsSync(venvPython)) {
  console.error(
    '\nNo se encontró el entorno virtual de Python en analytics/.venv\n' +
      'Créalo una vez con:\n\n' +
      '  cd analytics\n' +
      '  python -m venv .venv\n' +
      (process.platform === 'win32'
        ? '  .venv\\Scripts\\pip install -r requirements-dev.txt\n'
        : '  .venv/bin/pip install -r requirements-dev.txt\n'),
  );
  process.exit(1);
}

const child = spawn(venvPython, process.argv.slice(2), { cwd: analyticsDir, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
