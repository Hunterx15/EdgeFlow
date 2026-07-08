# EdgeFlow Frontend Dockerfile

FROM node:20-alpine AS builder

WORKDIR /app

COPY frontend/package*.json ./
RUN npm install --no-audit --no-fund

COPY frontend/ .

ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

FROM nginx:alpine

COPY docker/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
CMD wget -q --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]