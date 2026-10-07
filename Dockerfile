# Images de base épinglées par digest (reproductibilité / supply chain) ;
# Dependabot (écosystème docker) propose les mises à jour.
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS deps
# OpenSSL requis par le moteur Prisma sur Alpine.
RUN apk add --no-cache openssl && corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY database/package.json database/
RUN pnpm install --frozen-lockfile
COPY . .

FROM deps AS api-build
RUN pnpm --filter @billetto/api prisma:generate && pnpm --filter @billetto/api build
# Image finale minimale : dist (champ « files ») + dépendances de production
# uniquement (pas de sources ni de devDependencies). Le client Prisma généré est
# recopié à côté du @prisma/client déployé (même version, même lockfile).
RUN pnpm --filter @billetto/api deploy --prod --legacy /out \
 && src=$(readlink -f apps/api/node_modules/@prisma/client)/../../.prisma/client \
 && dst=$(readlink -f /out/node_modules/@prisma/client)/../../.prisma \
 && mkdir -p "$dst" && cp -r "$src" "$dst/client"

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS api
RUN apk add --no-cache openssl
WORKDIR /app
# Fichiers appartenant à root : l'utilisateur node ne peut pas modifier le code.
COPY --from=api-build /out /app
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]

FROM deps AS web-build
RUN pnpm --filter @billetto/web build

# nginx non-root (uid 101), écoute sur 8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine@sha256:65e3e85dbaed8ba248841d9d58a899b6197106c23cb0ff1a132b7bfe0547e4c0 AS web
COPY infra/nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /repo/apps/web/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
