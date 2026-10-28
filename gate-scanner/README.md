# J.N.N Gate Scanner (Windows)

Desktop app for Security staff that records gate-pass exits and returns from a QR scanner. It uses the existing J.N.N Campus Connect backend and accounts.

Full documentation (architecture, API, scanner setup, troubleshooting, update and rollback): [../docs/GATE_SCANNER.md](../docs/GATE_SCANNER.md)

```bash
npm install
npm test                                              # unit tests
GATE_SCANNER_API_URL=http://localhost:5000 npm run dev  # against a local backend
npm run dist                                          # → release/JNN-Gate-Scanner-Setup-<version>.exe
```

In a VS Code terminal, run `unset ELECTRON_RUN_AS_NODE` first, or Electron starts as plain Node.

| Path | What |
| --- | --- |
| `electron/main.cjs` | Window, IPC, permissions, serial port chooser |
| `electron/apiClient.cjs` | All HTTPS calls, token refresh, error classification |
| `electron/credentialStore.cjs` | DPAPI-encrypted refresh token |
| `electron/config.cjs` | Server URL resolution, settings |
| `src/lib/hidWedge.js` | Keyboard-scanner input parser (timing based) |
| `src/lib/serialReader.js`, `serialFraming.js` | USB virtual COM scanners |
| `src/lib/scanQueue.js` | Dedupe, ordering, idempotent submit, settle after timeout |
| `src/pages/` | Scanner, Dashboard, History, Diagnostics, Login, Terms |
| `tests/e2e/` | Real app + real backend end-to-end driver |
