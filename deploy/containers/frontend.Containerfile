ARG NODE_IMAGE=docker.io/library/node:20-bookworm-slim
ARG NGINX_IMAGE=docker.io/library/nginx:1.29-alpine

FROM ${NODE_IMAGE} AS builder

WORKDIR /app

ARG VITE_API_BASE=
ARG VITE_ENABLE_SW=true
ARG VITE_PUSH_PUBLIC_KEY=
ARG VITE_GOOGLE_CLIENT_ID=
ARG VITE_FEATURE_TIMESHEET_GRID=false

ENV VITE_API_BASE=${VITE_API_BASE}
ENV VITE_ENABLE_SW=${VITE_ENABLE_SW}
ENV VITE_PUSH_PUBLIC_KEY=${VITE_PUSH_PUBLIC_KEY}
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}
ENV VITE_FEATURE_TIMESHEET_GRID=${VITE_FEATURE_TIMESHEET_GRID}

COPY packages/frontend/package.json packages/frontend/package-lock.json ./packages/frontend/
COPY packages/frontend/scripts ./packages/frontend/scripts
RUN npm ci --prefix packages/frontend

COPY packages/frontend ./packages/frontend
RUN npm run build --prefix packages/frontend \
 && npm cache clean --force

FROM ${NGINX_IMAGE}

COPY deploy/containers/frontend.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/packages/frontend/dist /usr/share/nginx/html

EXPOSE 8080
