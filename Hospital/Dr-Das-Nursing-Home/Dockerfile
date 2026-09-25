FROM node:24.6.0-bookworm-slim AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY src ./src
RUN npm run build

FROM build AS test
COPY db/migrations ./db/migrations
COPY FEATURES.yaml HOSPITAL_CONFIG.yaml ./
COPY tests ./tests
CMD ["npm", "run", "test:integration"]

FROM node:24.6.0-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY db/migrations ./db/migrations
COPY FEATURES.yaml HOSPITAL_CONFIG.yaml ./
COPY public ./public
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
