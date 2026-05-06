const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'macro-prod-'));

try {
  // Write a minimal package.json with only production deps -- no packageManager field,
  // no scripts, no devDependencies. Running npm from /tmp/ avoids any yarn/corepack
  // interference that occurs when npm runs inside the yarn project tree.
  fs.writeFileSync(
    path.join(tmpdir, 'package.json'),
    JSON.stringify({ dependencies: pkg.dependencies }, null, 2)
  );

  execSync('npm install --omit=dev', { cwd: tmpdir, stdio: 'inherit' });

  const dest = path.resolve('dist/node_modules');
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true });
  fs.cpSync(path.join(tmpdir, 'node_modules'), dest, { recursive: true });
} finally {
  fs.rmSync(tmpdir, { recursive: true, force: true });
}
