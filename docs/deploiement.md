# Guide de déploiement — LORE (auto-hébergement clé en main)

Ce guide explique comment installer et exploiter LORE en production sur votre
propre serveur, en une commande. Il consolide tout ce qui se trouve dans
[`deploy/`](../deploy/). Il s'adresse à l'équipe technique d'un organisme de
formation (OF) ou à son prestataire d'hébergement.

Pour l'utilisation fonctionnelle (créer des programmes, inviter, attestations,
RGPD…), voir le [Guide administrateur](guide-administrateur.md).

---

## 1. Ce que déploie LORE

Une seule commande met en route une pile **durable et compatible TLS**, définie
dans [`deploy/docker-compose.prod.yml`](../deploy/docker-compose.prod.yml) :

| Service     | Rôle |
|-------------|------|
| `postgres`  | Base de données durable du moteur (volume nommé `pgdata`, *healthcheck*). |
| `lore`      | Le backend Go en **mode Postgres** ; migre le schéma automatiquement au démarrage. |
| `web`       | Le front Next.js (design LECTURE), build *standalone*. |
| `seed`      | Travail ponctuel de *seed* de démonstration (première exécution seulement, optionnel). |
| `caddy`     | Reverse proxy qui termine le TLS (HTTPS automatique via Let's Encrypt). |

Le navigateur ne joint **jamais** le backend directement : seul Caddy (80/443)
est destiné au trafic public. Le port web direct (3001) est limité à
`127.0.0.1` pour le diagnostic local ; Postgres reste sur le réseau interne
Docker.

---

## 2. Prérequis

- **Docker Engine** + le plugin **Docker Compose v2**. Vérifiez :
  ```sh
  docker compose version
  ```
- **openssl** (génération des secrets).
- Un serveur Linux (2 vCPU / 4 Go RAM suffisent pour un OF de taille modeste).
- **Pour le HTTPS automatique** : un nom de domaine public dont l'enregistrement
  DNS (A/AAAA) pointe vers ce serveur, et les ports 80 et 443 ouverts.

> Un LLM n'est **pas** un prérequis : LORE tourne en mode `instruction_only`
> (le moteur fonctionne sans appel LLM). Voir §6.

---

## 3. Installation en une commande

```sh
git clone <dépôt> lore && cd lore
./deploy/up.sh          # équivalent : make prod-up
```

Le script [`deploy/up.sh`](../deploy/up.sh), **idempotent et ré-exécutable sans
risque** :

1. vérifie Docker + le plugin Compose v2 + openssl ;
2. à la **première exécution**, crée `deploy/.env` à partir de
   [`deploy/.env.example`](../deploy/.env.example) en générant des secrets
   aléatoires forts (`POSTGRES_SUPERUSER_PASSWORD`, `LORE_DB_PASSWORD`,
   `JWT_SECRET`, `LORE_BOOTSTRAP_TOKEN`, `LORE_METRICS_TOKEN`,
   `SESSION_SECRET`). Il **n'écrase jamais** un `deploy/.env` existant ;
3. construit puis démarre la pile (`docker compose ... up -d --build`) ;
4. affiche l'URL et les commandes utiles.

Après quelques minutes (build initial), ouvrez :

- **Sans domaine (local) :** `http://localhost` (Caddy sur :80), ou le front
  directement sur `http://localhost:3001` depuis la machine hôte.
- **Avec TLS :** réglez `DOMAIN=` dans `deploy/.env` puis relancez `./deploy/up.sh`
  (voir §5).

La toute première visite vous amène à l'**assistant de première installation**
(`/setup`) : voir le [Guide administrateur](guide-administrateur.md#2-première-installation-lassistant-de-configuration).

---

## 4. Variables d'environnement

Toutes définies dans `deploy/.env` (modèle :
[`deploy/.env.example`](../deploy/.env.example)). **Ne jamais committer ce
fichier** ; gardez-le en `0600`.

| Variable | Obligatoire | Rôle |
|----------|:-----------:|------|
| `POSTGRES_SUPERUSER` | non (`postgres`) | Utilisateur Postgres de maintenance/init. Non utilisé par l'application. |
| `POSTGRES_DB` | non (`lore`) | Base Postgres. |
| `POSTGRES_SUPERUSER_PASSWORD` | **oui** | Mot de passe du superuser Postgres. `openssl rand -hex 32`. |
| `LORE_DB_USER` | non (`lore`) | Rôle applicatif Postgres créé/forcé en `NOSUPERUSER`. |
| `LORE_DB_PASSWORD` | **oui** | Mot de passe du rôle applicatif. `openssl rand -hex 32`. |
| `JWT_SECRET` | **oui** | Signe les JWT par utilisateur (≥ 32 octets). `openssl rand -hex 32`. |
| `LORE_BOOTSTRAP_TOKEN` | **oui** | Secret opérateur : protège la création de *membership*, l'émission de jetons et l'assistant de première installation. **Doit être identique** côté backend et côté web. `openssl rand -hex 24`. |
| `LORE_METRICS_TOKEN` | **oui** | Protège `GET /metrics`. À fournir en `Authorization: Bearer …` côté Prometheus. `openssl rand -hex 32`. |
| `SESSION_SECRET` | **oui** | Signe le cookie de session du front (≥ 32 octets). `openssl rand -hex 32`. |
| `LORE_LLM_PROVIDER` | non (`instruction_only`) | Fournisseur LLM. `instruction_only` = aucun appel LLM. |
| `LORE_LLM_MODEL` | non (`tenant-runtime`) | Modèle par défaut. |
| `DEFAULT_SEED_PASSWORD` | non (`lore123!`) | Mot de passe des comptes de démonstration *seedés*. **À changer** avant tout usage réel. |
| `LORE_SHOW_DEMO_LOGINS` | non (`0`) | `1` afficherait les identifiants de démo sur la page de connexion — **laissez `0`** en production. |
| `DOMAIN` | non (vide) | Nom d'hôte public pour le HTTPS automatique. Vide = HTTP local sur :80. |

Variables supplémentaires lues par le front (à ajouter dans `deploy/.env` selon
les besoins, voir [`web/.env.example`](../web/.env.example)) :

- `PUBLIC_APP_URL` — URL publique de l'app (`https://lms.votre-of.fr`), utilisée
  pour les **liens dans les e-mails d'invitation**. À définir en production
  (jamais dérivée de l'en-tête `Host`).
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` — si **toutes**
  sont définies, les invitations partent par SMTP ; sinon le message est écrit
  dans la console serveur (*dev outbox*).
- `DATABASE_URL` — si défini côté web, le magasin d'identifiants, l'émargement et
  les *tombstones* RGPD passent en Postgres (`lore_web_credentials`,
  `lore_attendance`, `lore_rgpd_erasures`, créées à la volée). Sinon, fichiers
  JSON dans le volume durable `web-gen`.

---

## 5. Domaine et TLS

Pour activer le HTTPS automatique :

1. Faites pointer un enregistrement DNS A/AAAA vers le serveur.
2. Dans `deploy/.env`, réglez :
   ```
   DOMAIN=lms.votre-of.fr
   PUBLIC_APP_URL=https://lms.votre-of.fr
   ```
3. Relancez :
   ```sh
   ./deploy/up.sh
   ```

Caddy ([`deploy/Caddyfile`](../deploy/Caddyfile)) obtient un certificat Let's
Encrypt automatiquement, sert `https://DOMAIN` et redirige HTTP → HTTPS. Avec
`DOMAIN` vide, Caddy sert du HTTP simple sur :80 (usage local).

Caddy ajoute aussi les en-têtes de sécurité de base :

- `Strict-Transport-Security` uniquement sur HTTPS ;
- `Content-Security-Policy` restrictive pour l'application Next.js ;
- `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` et
  `Permissions-Policy`.

---

## 6. LLM (optionnel)

Par défaut `LORE_LLM_PROVIDER=instruction_only` : le moteur produit des
instructions pédagogiques sans appeler de modèle. Pour activer la génération de
contenu, réglez `LORE_LLM_PROVIDER` (`ollama`, `openai`, `anthropic`, `gemini`,
`mistral`, `custom`) et `LORE_LLM_MODEL`, plus la clé API du fournisseur côté
backend. Si un appel échoue, LORE retombe sur le contenu *instruction-only* :
le moteur reste utilisable. La configuration peut être affinée par tenant /
programme / cohorte / apprenant (voir le [Guide administrateur](guide-administrateur.md#7-configurer-le-llm-portées)).

---

## 7. Où vivent les données, sauvegardes et restauration

**Données durables :**

- volume `pgdata` — toute la base Postgres (tenants, programmes, cohortes, états
  du moteur, événements, snapshots…) ;
- volume `web-gen` — le magasin d'identifiants du front (`.gen/users.json`,
  hachages bcrypt), l'émargement et les ids de *seed* (sauf si `DATABASE_URL` est
  défini côté web, auquel cas ces données sont en Postgres).

Ces volumes survivent à `make prod-down` et aux redémarrages — c'est ce qui rend
le déploiement durable. **`docker compose ... down -v` détruit toutes les
données.**

**Sauvegarde / restauration de la base :**

```sh
make backup-db                                   # pg_dump -> ./backups/lore-<horodatage>.sql.gz
make restore-db FILE=backups/lore-20260101-120000.sql.gz
```

> La restauration **écrase** les données existantes. Pensez aussi à sauvegarder le
> volume `web-gen` (ou la table `lore_web_credentials` si `DATABASE_URL` est
> défini) pour conserver les identifiants de connexion, et bien sûr `deploy/.env`.

Routine minimale recommandée :

1. Planifier `make backup-db` hors du dépôt, par exemple via cron :
   ```cron
   0 2 * * * cd /srv/lore && make backup-db >> /var/log/lore-backup.log 2>&1
   ```
2. Copier `backups/`, `deploy/.env` et le volume `web-gen` vers un stockage
   externe chiffré et versionné.
3. Tester une restauration complète au moins mensuellement sur une instance de
   préproduction : base Postgres, `deploy/.env`, puis volume `web-gen` si utilisé.
4. Conserver des sauvegardes couvrant votre obligation contractuelle/RGPD, puis
   purger automatiquement les archives expirées.

Pour le volume `web-gen`, le nom Docker exact dépend du nom de projet Compose.
Identifiez-le avec :

```sh
docker volume ls | grep web-gen
```

Exportez ensuite le volume choisi vers une archive :

```sh
docker run --rm \
  -v <volume-web-gen>:/web-gen:ro \
  -v "$PWD/backups":/backups \
  alpine:3.20 sh -c 'tar -C /web-gen -czf /backups/lore-web-gen-$(date +%Y%m%d-%H%M%S).tar.gz .'
```

Pour restaurer ce volume, arrêtez d'abord la pile, restaurez l'archive dans le
volume cible, puis relancez `./deploy/up.sh`.

---

## 8. Seed de démonstration

Le service `seed` exécute `web/scripts/seed.sh` **une seule fois** (à la première
exécution) pour créer un tenant + des utilisateurs/rôles + un domaine + un
syllabus de démonstration, puis écrit `seed.json` dans le volume `web-gen`. Un
marqueur dans le volume rend toute ré-exécution **inopérante** (jamais d'écrasement
de données réelles). À la demande : `make prod-seed`.

**Pour un démarrage de production vierge**, commentez le service `seed` dans
`deploy/docker-compose.prod.yml` (et retirez-le du `depends_on` de `web`) : le
système démarre vide et l'assistant `/setup` vous fait créer l'organisation et le
premier administrateur.

---

## 9. Exploitation au quotidien

Le `Makefile` expose :

| Cible | Action |
|-------|--------|
| `make prod-up` | Bootstrap en une commande (génère `deploy/.env` si absent, puis `up -d --build`). |
| `make prod-down` | Arrête la pile (volumes **préservés**). |
| `make prod-logs` | Suit les logs de tous les services. |
| `make prod-seed` | Lance le seed de démo (inopérant si déjà fait). |
| `make backup-db` | `pg_dump` vers `./backups/`. |
| `make restore-db FILE=…` | Restaure un dump. |

---

## 10. Mise à jour

```sh
git pull
./deploy/up.sh        # reconstruit les images et redéploie ; deploy/.env est conservé
```

Le backend ré-applique les migrations de schéma au démarrage (idempotent). Faites
une **sauvegarde (`make backup-db`) avant toute montée de version**.

---

## 11. Checklist de sécurité (à faire avant tout usage réel)

- [ ] **Secrets générés** : si vous créez `deploy/.env` à la main, générez
      `JWT_SECRET`, `SESSION_SECRET`, `POSTGRES_SUPERUSER_PASSWORD`,
      `LORE_DB_PASSWORD`, `LORE_METRICS_TOKEN` avec `openssl rand -hex 32` et
      `LORE_BOOTSTRAP_TOKEN` avec `openssl rand -hex 24`. `up.sh` le fait pour vous.
- [ ] **Rotation** de `JWT_SECRET`, `LORE_BOOTSTRAP_TOKEN` et `SESSION_SECRET`
      s'ils ont déjà été partagés ou copiés depuis un exemple.
- [ ] **`LORE_SHOW_DEMO_LOGINS=0`** (défaut) : aucun identifiant de démonstration
      affiché sur la page de connexion.
- [ ] **`PUBLIC_APP_URL`** défini sur votre URL publique HTTPS (liens d'invitation
      corrects et sûrs).
- [ ] **Changer `DEFAULT_SEED_PASSWORD`** avant tout seed, et faire réinitialiser
      le mot de passe des utilisateurs au premier login.
- [ ] **Réinitialisation forcée au premier login** : les utilisateurs invités sont
      contraints de définir leur propre mot de passe (comportement par défaut).
- [ ] `deploy/.env` en **`0600`** et hors du dépôt git.
- [ ] **Postgres non publié** sur l'hôte (réseau interne Compose uniquement) —
      seul Caddy (80/443) est destiné au réseau public ; le web (3001) reste
      en boucle locale.
- [ ] **En-têtes Caddy** conservés : HSTS en HTTPS, CSP, anti-framing et
      `nosniff`.
- [ ] **Prometheus** configuré avec `LORE_METRICS_TOKEN`; ne jamais exposer le
      backend directement sur Internet.
- [ ] **Sauvegardes** programmées (`make backup-db`) et restauration testée.
- [ ] **Divulgation sécurité** : procédure et contact local documentés à partir de
      [`SECURITY.md`](../SECURITY.md).

---

## 12. Observabilité (optionnel)

Le backend expose des métriques Prometheus sur `GET /metrics`. En production,
`LORE_METRICS_TOKEN` est obligatoire et le scrape doit envoyer :

```yaml
authorization:
  type: Bearer
  credentials: "<LORE_METRICS_TOKEN>"
```

Le backend n'est pas publié par le compose prod ; gardez cette règle réseau et
faites scraper Prometheus depuis le même réseau privé, un tunnel VPN, ou un
reverse proxy interne explicitement protégé.

Le traçage OpenTelemetry est désactivé par défaut ; activez-le via les variables OTLP standard
(`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`). Détails dans le
[README](../README.md#observability).

---

## 13. Haute disponibilité et limites actuelles

Le déploiement fourni est volontairement **mono-noeud** : un hôte Docker, une
base Postgres locale, un backend, un front et Caddy. C'est exploitable pour une
petite structure si les sauvegardes et restaurations sont testées, mais ce n'est
pas une architecture haute disponibilité.

Limites à connaître :

- une panne de l'hôte coupe l'accès jusqu'à restauration ou redémarrage ;
- Postgres n'est pas répliqué par défaut ;
- les volumes Docker (`pgdata`, `web-gen`, `caddy_data`) doivent être sauvegardés ;
- aucun basculement automatique n'est fourni ;
- les mises à jour doivent être précédées d'une sauvegarde et planifiées hors
  session critique.

Pour une exploitation plus robuste, placez Postgres sur un service managé ou un
cluster répliqué, stockez les sauvegardes hors site, utilisez un load balancer
TLS devant plusieurs frontends, et documentez une procédure de reprise avec RTO
et RPO validés par test.
