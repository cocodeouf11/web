#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
#  Soizic — Script de déploiement Debian (à exécuter en root)
#  Usage: sudo bash deploy_debian.sh
#  Couvre : MongoDB, Python venv, .env, systemd, nginx, build frontend
# ═══════════════════════════════════════════════════════════════════════════

set -e  # arrête le script à la première erreur

APP_DIR="/var/www/signature/web"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"
DOMAIN="signature.lesbruneau.fr"

echo "═══ 1. Vérification des prérequis ═══"

# Python 3 + venv + pip
if ! command -v python3 &>/dev/null; then apt-get update && apt-get install -y python3 python3-venv python3-pip; fi
apt-get install -y python3-venv python3-pip 2>/dev/null || true

# MongoDB (si pas déjà installé)
if ! command -v mongod &>/dev/null; then
    echo "→ Installation de MongoDB..."
    apt-get install -y gnupg curl
    curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
    echo "deb [signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] http://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" > /etc/apt/sources.list.d/mongodb-org-7.0.list
    apt-get update && apt-get install -y mongodb-org
    systemctl enable --now mongod
fi
systemctl start mongod || true
echo "→ MongoDB: $(systemctl is-active mongod)"

echo ""
echo "═══ 2. Création du backend/.env ═══"
cat > "$BACKEND_DIR/.env" << EOF
MONGO_URL=mongodb://localhost:27017
DB_NAME=soizic
JWT_SECRET=$(openssl rand -hex 32)
CORS_ORIGINS=http://${DOMAIN},https://${DOMAIN}
COOKIE_SECURE=false
COOKIE_SAMESITE=lax
EOF
echo "→ $BACKEND_DIR/.env créé"

echo ""
echo "═══ 3. Création du frontend/.env ═══"
cat > "$FRONTEND_DIR/.env" << EOF
REACT_APP_BACKEND_URL=
WDS_SOCKET_PORT=443
EOF
echo "→ $FRONTEND_DIR/.env créé (URL backend = relative, via nginx proxy)"

echo ""
echo "═══ 4. Installation des dépendances Python ═══"
cd "$BACKEND_DIR"
rm -rf venv
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
echo "→ venv prêt: $BACKEND_DIR/venv"

echo ""
echo "═══ 5. Test manuel rapide du backend ═══"
deactivate
source venv/bin/activate
# lance en arrière-plan, attend 5s, teste, tue
nohup uvicorn server:app --host 127.0.0.1 --port 8001 > /tmp/soizic_test.log 2>&1 &
TEST_PID=$!
sleep 5
if curl -sf http://127.0.0.1:8001/api/ > /dev/null; then
    echo "→ Backend OK ✅"
else
    echo "→ Backend KO ❌ — voici les logs :"
    cat /tmp/soizic_test.log
    kill $TEST_PID 2>/dev/null || true
    exit 1
fi
kill $TEST_PID 2>/dev/null || true
sleep 1

echo ""
echo "═══ 6. Création du service systemd ═══"
cat > /etc/systemd/system/soizic-backend.service << EOF
[Unit]
Description=Soizic Backend (FastAPI)
After=network.target mongod.service
Requires=mongod.service

[Service]
Type=simple
User=root
WorkingDirectory=$BACKEND_DIR
Environment="PATH=$BACKEND_DIR/venv/bin"
ExecStart=$BACKEND_DIR/venv/bin/uvicorn server:app --host 127.0.0.1 --port 8001
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable soizic-backend
systemctl restart soizic-backend
sleep 3
systemctl is-active soizic-backend && echo "→ Service systemd: actif ✅" || (
    echo "→ Service KO ❌"
    journalctl -u soizic-backend -n 30 --no-pager
    exit 1
)

echo ""
echo "═══ 7. Configuration nginx ═══"
cat > /etc/nginx/sites-available/signature << EOF
server {
    listen 80;
    server_name ${DOMAIN};

    root ${FRONTEND_DIR}/build;
    index index.html;

    client_max_body_size 20M;

    location / {
        try_files \$uri /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
ln -sf /etc/nginx/sites-available/signature /etc/nginx/sites-enabled/signature
nginx -t && systemctl reload nginx
echo "→ nginx rechargé ✅"

echo ""
echo "═══ 8. Build du frontend ═══"
cd "$FRONTEND_DIR"
rm -rf build
npm run build
echo "→ Build créé: $FRONTEND_DIR/build ✅"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✅ DÉPLOIEMENT TERMINÉ"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "Tests finaux :"
curl -s http://127.0.0.1:8001/api/ && echo ""
curl -s http://${DOMAIN}/api/ && echo ""
echo ""
echo "Connectez-vous sur http://${DOMAIN}"
echo "  Identifiants : admin / admin123"
echo ""
echo "Logs en direct :"
echo "  sudo journalctl -u soizic-backend -f"
echo ""
