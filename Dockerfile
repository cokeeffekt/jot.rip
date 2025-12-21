# Multi-stage build: build client then serve with sync API
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV PORT=4000
ENV DATA_DIR=/data
ENV DIST_DIR=/app/dist

# Runtime deps only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy server and built client
COPY server ./server
COPY --from=build /app/dist ./dist

VOLUME ["/data"]
EXPOSE 4000
CMD ["node", "server/index.js"]
