import {runInstaller} from './core/install.mjs';
try { await runInstaller(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
