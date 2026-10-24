# Typing Duel
- `backend` Node.js + `ws` (port 3000, env PORT). Endpoints: `GET /api/health`, WebSocket `/api/ws`.
- `frontend` static files. All calls go to `/api/...` on the same host, so reverse-proxy `/api/` to the backend
  (WebSocket upgrade needed: `proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`).
- Local test: `cd backend && npm i && STATIC_DIR=../frontend npm start`, open http://localhost:3000 in two tabs, same room code.
- Ganti karakter: timpa file di `frontend` (atau ubah nama file di `characters.json` kalau pakai .gif).
- Ganti background: `frontend/assets/bg.svg` (atau ubah path di style.css).
- Ability ada di `backend/characters.js` (kunci = id karakter).
