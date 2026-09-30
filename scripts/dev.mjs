// Runs the API/proxy server and the editor dev server together.
import { spawn } from 'node:child_process';

const procs = [
  ['server', 'npm', ['-w', '@pixelforge/server', 'run', 'dev']],
  ['editor', 'npm', ['-w', '@pixelforge/editor', 'run', 'dev']],
].map(([name, cmd, args]) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const prefix = (d) => d.toString().split('\n').filter(Boolean).map((l) => `[${name}] ${l}`).join('\n') + '\n';
  p.stdout.on('data', (d) => process.stdout.write(prefix(d)));
  p.stderr.on('data', (d) => process.stderr.write(prefix(d)));
  p.on('exit', (code) => {
    console.log(`[${name}] exited with ${code}`);
    procs.forEach((q) => q.kill('SIGTERM'));
    process.exit(code ?? 0);
  });
  return p;
});
console.log('\n  PixelForge editor → http://localhost:5173\n');
const stop = () => procs.forEach((p) => p.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
