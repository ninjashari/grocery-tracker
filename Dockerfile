# Node 24+ is required: the server runs TypeScript directly via native type stripping,
# and the database uses the built-in node:sqlite module. No native modules to compile.
FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=5174
ENV DATA_DIR=/data

# Bind-mount or name a volume here; the SQLite file lives inside it.
VOLUME ["/data"]
EXPOSE 5174

CMD ["node", "server/index.ts"]
