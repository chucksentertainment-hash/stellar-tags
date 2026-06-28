FROM node:20-alpine AS base
WORKDIR /app

# --- Backend ---
FROM base AS backend
COPY stellar-payment-platform/package*.json ./
RUN npm ci
COPY stellar-payment-platform/ .
RUN npx prisma generate
EXPOSE 5000
CMD ["node", "server.js"]

# --- Frontend build ---
FROM base AS frontend-build
COPY payment-dashboard/package*.json ./
RUN npm ci
COPY payment-dashboard/ .
ARG VITE_API_BASE=http://localhost:5000
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

# --- Frontend serve ---
FROM nginx:alpine AS frontend
COPY --from=frontend-build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
