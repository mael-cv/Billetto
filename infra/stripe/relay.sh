#!/bin/sh
# Relais des webhooks Stripe (mode test) vers l'API.
# La clé vient de la configuration écrite par l'assistant de premier démarrage ;
# elle est passée par l'environnement, jamais en argument de commande.
set -eu

CONFIG=/config/api.env

# Valeur d'une variable du fichier de configuration (retour chariot éventuel retiré).
value() {
  sed -n "s/^$1=//p" "$CONFIG" 2>/dev/null | head -n 1 | tr -d '\r'
}

echo "relais Stripe : en attente de l'initialisation de l'application"
while :; do
  MODE="$(value APP_MODE)"
  if [ "$MODE" = "test" ] || [ "$MODE" = "live" ]; then
    break
  fi
  sleep 5
done

if [ "$MODE" = "live" ]; then
  echo "relais Stripe : mode live, le webhook se déclare dans le tableau de bord Stripe. Rien à relayer."
  # Reste en veille plutôt que de redémarrer en boucle.
  exec tail -f /dev/null
fi

STRIPE_API_KEY="$(value STRIPE_SECRET_KEY)"
if [ -z "$STRIPE_API_KEY" ]; then
  echo "relais Stripe : aucune clé de test configurée, paiement par carte désactivé."
  exec tail -f /dev/null
fi

export STRIPE_API_KEY
export STRIPE_DEVICE_NAME=billetto-compose
echo "relais Stripe : transmission des paiements vers l'API"
exec stripe listen --events checkout.session.completed --forward-to http://api:3001/api/v1/payments/webhook
