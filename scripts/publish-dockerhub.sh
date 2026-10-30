#!/usr/bin/env bash
set -e

DOCKER_USER="${1:-}"

if [ -z "$DOCKER_USER" ] && [ -f .env ]; then
  DOCKER_USER=$(grep -E "^DOCKER_USER=" .env | cut -d '=' -f2 | tr -d ' \r\n')
fi

if [ -z "$DOCKER_USER" ] || [ "$DOCKER_USER" = "monpseudo" ]; then
  read -rp "Entrez votre nom d'utilisateur Docker Hub (ex: litmaaa) : " DOCKER_USER
fi

if [ -z "$DOCKER_USER" ]; then
  echo "Erreur : nom d'utilisateur Docker Hub manquant."
  exit 1
fi

echo "===================================================="
echo "📦 Publication des images Billetto sur Docker Hub"
echo "   Compte : $DOCKER_USER"
echo "===================================================="

INIT_IMG="${DOCKER_USER}/billetto-init:latest"
API_IMG="${DOCKER_USER}/billetto-api:latest"
WEB_IMG="${DOCKER_USER}/billetto-web:latest"

echo -e "\n[1/3] Construction de l'image init ($INIT_IMG)..."
docker build --target init -t "$INIT_IMG" .

echo -e "\n[2/3] Construction de l'image api ($API_IMG)..."
docker build --target api -t "$API_IMG" .

echo -e "\n[3/3] Construction de l'image web ($WEB_IMG)..."
docker build --target web -t "$WEB_IMG" .

echo -e "\n📤 Push vers Docker Hub..."
docker push "$INIT_IMG"
docker push "$API_IMG"
docker push "$WEB_IMG"

echo -e "\n===================================================="
echo "✓ Images publiées avec succès sur Docker Hub :"
echo "  - $INIT_IMG"
echo "  - $API_IMG"
echo "  - $WEB_IMG"
echo "===================================================="
echo "Fichiers à remettre au professeur :"
echo "  1. docker-compose.yml"
echo "  2. .env (avec DOCKER_USER=$DOCKER_USER)"
echo "Commande pour le professeur : docker compose up -d"
