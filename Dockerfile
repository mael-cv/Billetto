FROM node:22-alpine AS deps
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY database/package.json database/
RUN pnpm install --frozen-lockfile
COPY . .

FROM deps AS api-build
RUN pnpm --filter @billetto/api prisma:generate && pnpm --filter @billetto/api build

FROM node:22-alpine AS api
WORKDIR /repo
COPY --from=api-build /repo /repo
USER node
WORKDIR /repo/apps/api
EXPOSE 3001
CMD ["node", "dist/main.js"]

FROM deps AS web-build
RUN pnpm --filter @billetto/web build

FROM nginx:1.27-alpine AS web
COPY --from=web-build /repo/apps/web/dist /usr/share/nginx/html
