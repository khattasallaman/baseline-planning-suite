# Multi-stage: build all three federated apps, serve via nginx.
# Host needs only Docker — no Node required on the host.

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
COPY apps/shell/package.json apps/shell/
COPY apps/people/package.json apps/people/
COPY apps/delivery/package.json apps/delivery/

RUN npm install

COPY . .

RUN npm run generate:seed \
 && npm run build -w @baseline/contracts \
 && npm run build -w @baseline/domain \
 && npm run test -w @baseline/domain \
 && npm run build -w @baseline/people \
 && npm run build -w @baseline/delivery \
 && npm run build -w @baseline/shell

FROM nginx:1.27-alpine
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/shell/dist /usr/share/nginx/html/shell
COPY --from=build /app/apps/people/dist /usr/share/nginx/html/people
COPY --from=build /app/apps/delivery/dist /usr/share/nginx/html/delivery
COPY apps/shell/public/config.json /usr/share/nginx/html/config.json

EXPOSE 80
