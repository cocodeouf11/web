"""
═══════════════════════════════════════════════════════════════════════════════
  FICHIER DE CONFIGURATION — Soizic
═══════════════════════════════════════════════════════════════════════════════

  👉 Modifiez ce fichier pour gérer les utilisateurs et leurs droits.
  👉 Redémarrez le backend après modification : `sudo supervisorctl restart backend`

  Tout ce qui se trouve ici est synchronisé automatiquement avec la base
  de données au démarrage du serveur.
═══════════════════════════════════════════════════════════════════════════════
"""

# ─────────────────────────────────────────────────────────────────────────────
#  1. UTILISATEURS
# ─────────────────────────────────────────────────────────────────────────────
#
#  Ajoutez / modifiez / supprimez des utilisateurs ici.
#  Champs obligatoires : username, password, role
#
#  Rôles disponibles : "super_admin"  ou  "gestionnaire"
#    • super_admin   → voit TOUS les devis, gère les comptes gestionnaires
#    • gestionnaire  → voit uniquement SES propres devis
#
#  Notes :
#   - Les noms d'utilisateurs sont automatiquement passés en minuscules.
#   - Les mots de passe sont hashés (bcrypt) avant insertion en DB.
#   - À chaque redémarrage : nouveaux utilisateurs créés, mots de passe
#     mis à jour si modifiés, rôles synchronisés.
# ─────────────────────────────────────────────────────────────────────────────

USERS = [
    # ── Super admin (peut tout faire) ──
    {
        "username": "admin",
        "password": "admin123",
        "role": "super_admin",
    },

    # ── Exemple : décommentez pour ajouter un gestionnaire ──
    # {
    #     "username": "marie",
    #     "password": "marie2026",
    #     "role": "gestionnaire",
    # },
]


# ─────────────────────────────────────────────────────────────────────────────
#  2. RÔLES & PERMISSIONS
# ─────────────────────────────────────────────────────────────────────────────
#
#  Chaque rôle a une liste de permissions. Le frontend peut afficher/cacher
#  des éléments en fonction de ces permissions (exposées via /api/auth/me).
#
#  Permissions reconnues par l'application :
#    - "manage_users"      → gérer les comptes (créer/modifier/supprimer)
#    - "view_all_files"    → voir TOUS les fichiers (sinon : uniquement les siens)
#    - "upload_files"      → téléverser des PDF
#    - "delete_files"      → supprimer des fichiers
#    - "generate_codes"    → générer des codes d'accès signataire
#    - "modify_status"     → modifier le statut d'un fichier (signé/non signé)
# ─────────────────────────────────────────────────────────────────────────────

ROLES = {
    "super_admin": {
        "label": "Super admin",
        "permissions": [
            "manage_users",
            "view_all_files",
            "upload_files",
            "delete_files",
            "generate_codes",
            "modify_status",
        ],
    },
    "gestionnaire": {
        "label": "Gestionnaire",
        "permissions": [
            "upload_files",
            "delete_files",      # uniquement sur ses propres fichiers
            "generate_codes",    # uniquement sur ses propres fichiers
            "modify_status",     # uniquement sur ses propres fichiers
        ],
    },
}


# ─────────────────────────────────────────────────────────────────────────────
#  3. PARAMÈTRES DE SYNCHRONISATION
# ─────────────────────────────────────────────────────────────────────────────

#  Si True : les mots de passe en DB sont remis à jour à chaque redémarrage
#  pour correspondre à ceux définis ci-dessus.
#  Si False : seuls les nouveaux utilisateurs auront leur mot de passe défini ici.
SYNC_PASSWORDS = True

#  Si True : les utilisateurs présents en DB mais absents de la liste USERS
#  ci-dessus sont SUPPRIMÉS automatiquement (avec leurs fichiers).
#  ⚠️ Activez cette option avec prudence.
SYNC_DELETE_MISSING = False

#  Limites
MAX_PDF_SIZE_MB = 10  # taille maximale d'un PDF uploadé
ACCESS_CODE_PREFIX = "DEV"  # préfixe des codes d'accès signataire (ex: DEV-12345-AB)
