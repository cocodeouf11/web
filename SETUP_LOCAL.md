# 🚀 Soizic — Guide d'installation locale

## Architecture

```
┌──────────────────┐         ┌──────────────────┐
│  Frontend React  │ ──API──>│  Backend FastAPI │
│   (port 3000)    │         │    (port 8001)    │
└──────────────────┘         └─────────┬────────┘
                                       │
                                ┌──────▼──────┐
                                │   MongoDB   │
                                │   (27017)   │
                                └─────────────┘
```

---

## 1. Pré-requis

- **Node.js** ≥ 18
- **Python** ≥ 3.10
- **MongoDB** ≥ 5.0
- **Yarn** (recommandé) ou **npm**

---

## 2. Configuration des variables d'environnement

### Backend — `backend/.env`

```env
MONGO_URL="mongodb://localhost:27017"
DB_NAME="soizic"
JWT_SECRET="changez-moi-en-une-chaine-aleatoire-de-64-caracteres"

# CORS : URLs autorisées du frontend (séparées par virgule, sans espace)
CORS_ORIGINS="http://localhost:3000,http://192.168.1.29:3000"

# Cookies : false en HTTP local, true en HTTPS production
COOKIE_SECURE="false"
COOKIE_SAMESITE="lax"
```

> 💡 **Important** : En **HTTP local**, mettez `COOKIE_SECURE="false"` sinon le navigateur refuse les cookies.
> En **HTTPS production**, mettez `COOKIE_SECURE="true"` et `COOKIE_SAMESITE="none"`.

### Frontend — `frontend/.env`

Pointez vers l'URL **publique** où votre backend est accessible **depuis le navigateur** :

```env
# Si le backend tourne sur la même machine et que vous y accédez via http://192.168.1.29:3000 :
REACT_APP_BACKEND_URL=http://192.168.1.29:8001

# Si vous accédez en localhost :
# REACT_APP_BACKEND_URL=http://localhost:8001
```

---

## 3. Installation des utilisateurs

Modifiez `backend/config.py` pour ajouter vos comptes :

```python
USERS = [
    {"username": "admin",  "password": "admin123",  "role": "super_admin"},
    {"username": "marie",  "password": "marie2026", "role": "gestionnaire"},
]
```

---

## 4. Démarrage

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

### Frontend
```bash
cd frontend
yarn install      # ou : npm install
yarn start        # ou : npm start
```

L'app est accessible sur **http://localhost:3000** (ou l'IP de votre serveur).

---

## 5. Diagnostic en cas d'erreur

### "Une erreur est survenue" / "Impossible de joindre le serveur"

Ouvrez les **DevTools du navigateur (F12)** → onglet **Network** → cliquez sur "Se connecter" et regardez l'appel `POST /api/auth/login`.

| Symptôme                              | Cause                                                  | Solution                                                       |
| ------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------- |
| `CORS error` / `blocked by CORS`      | Backend ne connaît pas l'origine du frontend           | Ajoutez l'URL exacte dans `CORS_ORIGINS` du backend            |
| `404 Not Found` sur `/api/auth/login` | Mauvaise URL backend                                   | Vérifiez `REACT_APP_BACKEND_URL` dans `frontend/.env`          |
| `Failed to fetch`                     | Backend pas démarré, ou port bloqué                    | Testez `curl http://VOTRE_IP:8001/api/`                        |
| `401 Identifiants invalides`          | Mauvais mot de passe                                   | Vérifiez `backend/config.py`                                   |
| Login OK mais pas de redirection      | Cookie rejeté (HTTPS-only en HTTP)                     | Mettez `COOKIE_SECURE="false"` dans `backend/.env`             |

### Faux warning "ResizeObserver loop"

C'est un faux-positif inoffensif déjà filtré dans `public/index.html`. Si vous le voyez encore, faites un **hard refresh** (Ctrl+Shift+R).

---

## 6. Build production

```bash
cd frontend
yarn build        # génère ./build/
```

Servez le contenu de `frontend/build/` derrière un reverse-proxy (nginx, Caddy, etc.) en HTTPS, et configurez `COOKIE_SECURE="true"` côté backend.
